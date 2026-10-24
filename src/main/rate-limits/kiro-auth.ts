import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { readKiroCliToken } from '../foreign-sqlite-readers/foreign-sqlite-reader-spawn'

const DEFAULT_REGION = 'us-east-1'
const TOKEN_SKEW_MS = 60_000

export type KiroAuthSource = 'cli' | 'ide'

export type KiroAuthSession = {
  accessToken: string
  expiresAtMs: number | null
  region: string
  source: KiroAuthSource
}

export type KiroAuthReadResult =
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'ok'; session: KiroAuthSession }

/** kiro-cli's database lives in the platform data-local dir (Rust `dirs::data_local_dir`). */
export function getKiroCliDbPath(): string {
  if (process.platform === 'darwin') {
    return join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3')
  }
  if (process.platform === 'win32') {
    const root = process.env.LOCALAPPDATA?.trim() || join(os.homedir(), 'AppData', 'Local')
    return join(root, 'kiro-cli', 'data.sqlite3')
  }
  const root = process.env.XDG_DATA_HOME?.trim() || join(os.homedir(), '.local', 'share')
  return join(root, 'kiro-cli', 'data.sqlite3')
}

/** The Kiro IDE writes its Builder ID / IdC session to the shared AWS SSO cache. */
export function getKiroIdeTokenPath(): string {
  return join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json')
}

const ideTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().nullish(),
  region: z.string().nullish()
})

function parseExpiresAtMs(iso: string | null | undefined): number | null {
  if (!iso) {
    return null
  }
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export function isKiroAccessTokenFresh(session: KiroAuthSession): boolean {
  return session.expiresAtMs === null || session.expiresAtMs - Date.now() > TOKEN_SKEW_MS
}

async function readIdeSession(): Promise<KiroAuthReadResult> {
  let raw: string
  try {
    raw = await readFile(getKiroIdeTokenPath(), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'missing' }
    }
    return { status: 'error', error: 'Unable to read the Kiro IDE login' }
  }
  try {
    const parsed = ideTokenSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return { status: 'missing' }
    }
    return {
      status: 'ok',
      session: {
        accessToken: parsed.data.accessToken,
        expiresAtMs: parseExpiresAtMs(parsed.data.expiresAt),
        region: parsed.data.region || DEFAULT_REGION,
        source: 'ide'
      }
    }
  } catch {
    return { status: 'error', error: 'Kiro IDE login file is invalid' }
  }
}

async function readCliSession(): Promise<KiroAuthReadResult> {
  const result = await readKiroCliToken(getKiroCliDbPath())
  if (result.status !== 'ok') {
    return result
  }
  return {
    status: 'ok',
    session: {
      accessToken: result.token.accessToken,
      expiresAtMs: parseExpiresAtMs(result.token.expiresAt),
      region: result.token.region || DEFAULT_REGION,
      source: 'cli'
    }
  }
}

function expiresLater(left: KiroAuthSession, right: KiroAuthSession): boolean {
  return (left.expiresAtMs ?? Number.POSITIVE_INFINITY) > (right.expiresAtMs ?? 0)
}

// Why read-only: Orca never refreshes Kiro tokens — refresh tokens rotate, and writing one back would sign out kiro-cli.
export async function readKiroAuthSession(): Promise<KiroAuthReadResult> {
  const results = await Promise.all([readCliSession(), readIdeSession()])
  const sessions = results.flatMap((result) => (result.status === 'ok' ? [result.session] : []))
  const fresh = sessions.filter(isKiroAccessTokenFresh)
  const pool = fresh.length > 0 ? fresh : sessions
  const best = pool.reduce<KiroAuthSession | null>(
    (current, session) => (current === null || expiresLater(session, current) ? session : current),
    null
  )
  if (best) {
    return { status: 'ok', session: best }
  }
  const failure = results.find((result) => result.status === 'error')
  return failure ?? { status: 'missing' }
}
