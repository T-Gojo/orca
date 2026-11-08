import { existsSync } from 'node:fs'
import SyncDatabase from '../../sqlite/sync-database'
import {
  KIRO_LOGIN_AUTH_KEYS,
  KIRO_LOGIN_STATE_KEYS,
  decodeKiroCliLogin,
  encodeKiroCliLogin,
  hasKiroCliLoginToken,
  type KiroCliLoginRows
} from '../../kiro/kiro-cli-login'
import type { KiroCliLoginReadResult, KiroCliLoginWriteResult } from '../kiro-cli-login-result'

const OPEN_TIMEOUT_MS = 250
// Why longer: kiro-cli may hold the write lock while it refreshes its own token.
const WRITE_TIMEOUT_MS = 3_000

function placeholders(keys: readonly string[]): string {
  return keys.map(() => '?').join(', ')
}

function valueAsString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8')
  }
  return null
}

function readRows(
  db: SyncDatabase,
  table: 'auth_kv' | 'state',
  keys: readonly string[]
): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of db
    .prepare(`SELECT key, value FROM ${table} WHERE key IN (${placeholders(keys)})`)
    .all(...keys)) {
    const value = valueAsString(row.value)
    if (typeof row.key === 'string' && value !== null) {
      rows[row.key] = value
    }
  }
  return rows
}

function readLogin(db: SyncDatabase): string | null {
  const rows: KiroCliLoginRows = {
    auth: readRows(db, 'auth_kv', KIRO_LOGIN_AUTH_KEYS),
    state: readRows(db, 'state', KIRO_LOGIN_STATE_KEYS)
  }
  return hasKiroCliLoginToken(rows.auth) ? encodeKiroCliLogin(rows) : null
}

/** Open only in a worker: kiro-cli keeps chat history in the same database. */
export function readKiroCliLogin(dbPath: string): KiroCliLoginReadResult {
  if (!existsSync(dbPath)) {
    return { status: 'missing' }
  }
  let db: SyncDatabase | null = null
  try {
    db = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true, timeout: OPEN_TIMEOUT_MS })
    const contents = readLogin(db)
    return contents === null ? { status: 'missing' } : { status: 'ok', contents }
  } catch {
    return { status: 'error', error: 'Unable to read the Kiro CLI login' }
  } finally {
    db?.close()
  }
}

/**
 * Replaces kiro-cli's login (null signs it out) only while it still holds `expected`, so its own
 * token refresh is never lost.
 */
export function writeKiroCliLogin(
  dbPath: string,
  contents: string | null,
  expected: string | null
): KiroCliLoginWriteResult {
  const next = contents === null ? { auth: {}, state: {} } : decodeKiroCliLogin(contents)
  if (!existsSync(dbPath)) {
    return { status: 'error', error: 'Kiro CLI has no database on this computer yet.' }
  }
  let db: SyncDatabase | null = null
  try {
    db = new SyncDatabase(dbPath, { fileMustExist: true, timeout: WRITE_TIMEOUT_MS })
    db.exec('BEGIN IMMEDIATE')
    try {
      if (readLogin(db) !== expected) {
        db.exec('ROLLBACK')
        return { status: 'conflict' }
      }
      db.prepare(`DELETE FROM auth_kv WHERE key IN (${placeholders(KIRO_LOGIN_AUTH_KEYS)})`).run(
        ...KIRO_LOGIN_AUTH_KEYS
      )
      db.prepare(`DELETE FROM state WHERE key IN (${placeholders(KIRO_LOGIN_STATE_KEYS)})`).run(
        ...KIRO_LOGIN_STATE_KEYS
      )
      const insertAuth = db.prepare('INSERT INTO auth_kv (key, value) VALUES (?, ?)')
      for (const [key, value] of Object.entries(next.auth)) {
        insertAuth.run(key, value)
      }
      const insertState = db.prepare('INSERT INTO state (key, value) VALUES (?, ?)')
      for (const [key, value] of Object.entries(next.state)) {
        insertState.run(key, value)
      }
      db.exec('COMMIT')
      return { status: 'ok' }
    } catch (error) {
      if (db.isTransaction) {
        db.exec('ROLLBACK')
      }
      throw error
    }
  } catch {
    return { status: 'error', error: 'Unable to switch the Kiro CLI login' }
  } finally {
    db?.close()
  }
}
