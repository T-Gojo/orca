import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { encodeKiroCliLogin } from '../../kiro/kiro-cli-login'
import { readKiroCliLogin, writeKiroCliLogin } from './kiro-cli-login'

let dir: string
let dbPath: string

function loginOf(user: string): string {
  return encodeKiroCliLogin({
    auth: {
      'kirocli:odic:token': JSON.stringify({ access_token: `${user}-access`, region: 'us-east-1' }),
      'kirocli:odic:device-registration': JSON.stringify({ client_id: `${user}-client` })
    },
    state: { 'auth.idc.region': '"us-east-1"' }
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-kiro-login-'))
  dbPath = join(dir, 'data.sqlite3')
  const db = new SyncDatabase(dbPath)
  db.exec('CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT)')
  db.exec('CREATE TABLE state (key TEXT PRIMARY KEY, value BLOB)')
  db.exec("INSERT INTO state (key, value) VALUES ('chat.defaultModel', '\"auto\"')")
  db.exec("INSERT INTO auth_kv (key, value) VALUES ('telemetryClientId', 'keep-me')")
  db.close()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function otherRows(): unknown[] {
  const db = new SyncDatabase(dbPath, { readonly: true })
  try {
    return db
      .prepare(
        "SELECT key, value FROM auth_kv WHERE key = 'telemetryClientId' UNION ALL SELECT key, value FROM state WHERE key = 'chat.defaultModel'"
      )
      .all()
  } finally {
    db.close()
  }
}

describe('kiro-cli login rows', () => {
  it('signs in, switches and signs out only while kiro-cli holds the expected login', () => {
    expect(readKiroCliLogin(dbPath)).toEqual({ status: 'missing' })

    expect(writeKiroCliLogin(dbPath, loginOf('a'), null)).toEqual({ status: 'ok' })
    expect(readKiroCliLogin(dbPath)).toEqual({ status: 'ok', contents: loginOf('a') })

    // kiro-cli refreshed or switched since Orca looked: nothing is overwritten.
    expect(writeKiroCliLogin(dbPath, loginOf('b'), loginOf('c'))).toEqual({ status: 'conflict' })
    expect(readKiroCliLogin(dbPath)).toEqual({ status: 'ok', contents: loginOf('a') })

    expect(writeKiroCliLogin(dbPath, loginOf('b'), loginOf('a'))).toEqual({ status: 'ok' })
    expect(readKiroCliLogin(dbPath)).toEqual({ status: 'ok', contents: loginOf('b') })

    expect(writeKiroCliLogin(dbPath, null, loginOf('b'))).toEqual({ status: 'ok' })
    expect(readKiroCliLogin(dbPath)).toEqual({ status: 'missing' })
    expect(otherRows()).toEqual([
      { key: 'telemetryClientId', value: 'keep-me' },
      { key: 'chat.defaultModel', value: '"auto"' }
    ])
  })
})
