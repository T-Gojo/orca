import { existsSync } from 'node:fs'
import { z } from 'zod'
import SyncDatabase from '../../sqlite/sync-database'
import { kiroCliTokenReadFailure, type KiroCliTokenReadResult } from '../kiro-cli-token-result'

// Why two keys: kiro-cli kept Amazon Q CLI's database layout, and older installs still hold the Q key.
const TOKEN_KEYS = ['kirocli:odic:token', 'codewhisperer:odic:token'] as const
const OPEN_TIMEOUT_MS = 250

const rowsSchema = z.array(z.object({ key: z.unknown(), value: z.unknown() }).partial())
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.string().nullish(),
  region: z.string().nullish()
})

function valueAsString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8').trim() || null
  }
  return null
}

/** Open only in a worker: kiro-cli keeps chat history in the same database. */
export function readKiroCliToken(dbPath: string): KiroCliTokenReadResult {
  if (!existsSync(dbPath)) {
    return { status: 'missing' }
  }
  let db: SyncDatabase | null = null
  try {
    db = new SyncDatabase(dbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: OPEN_TIMEOUT_MS
    })
    const rows = rowsSchema.parse(
      db.prepare('SELECT key, value FROM auth_kv WHERE key IN (?, ?)').all(...TOKEN_KEYS)
    )
    for (const key of TOKEN_KEYS) {
      const raw = valueAsString(rows.find((row) => row.key === key)?.value)
      if (!raw) {
        continue
      }
      const parsed = tokenSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        return {
          status: 'ok',
          token: {
            accessToken: parsed.data.access_token,
            expiresAt: parsed.data.expires_at ?? null,
            region: parsed.data.region ?? null
          }
        }
      }
    }
    return { status: 'missing' }
  } catch {
    return kiroCliTokenReadFailure()
  } finally {
    db?.close()
  }
}
