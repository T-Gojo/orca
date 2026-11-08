import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One saved agy login, in the shape agy keeps in its own credential store. */
export type ImportedAntigravityLogin = { email: string | null; contents: string }

const MAX_FILE_BYTES = 4 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fork: Bridge Hub (openai-base-bridge) keeps its signed-in Antigravity CLI accounts here. */
export function bridgeHubAntigravityAccountsPath(env: NodeJS.ProcessEnv = process.env): string {
  const support =
    env.OPENAI_BASE_WINDSURF_SUPPORT_DIR?.trim() ||
    env.CURSOR_WINDSURF_SUPPORT_DIR?.trim() ||
    join(homedir(), 'Library', 'Application Support', 'openai-base-windsurf-bridge')
  return join(support, 'auth', 'antigravity-cli-accounts.json')
}

/**
 * Reads Bridge Hub's saved agy accounts as agy logins. Bridge Hub writes these same logins into
 * agy's credential store when it switches accounts, so each one is a working agy sign-in.
 */
export function readBridgeHubAntigravityLogins(
  path = bridgeHubAntigravityAccountsPath()
): ImportedAntigravityLogin[] {
  if (!existsSync(path)) {
    return []
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    throw new Error('The Bridge Hub Antigravity account file could not be read safely.')
  }
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const accounts = isRecord(value) && Array.isArray(value.accounts) ? value.accounts : []
  const logins: ImportedAntigravityLogin[] = []
  for (const account of accounts) {
    if (!isRecord(account) || typeof account.refreshToken !== 'string' || !account.refreshToken) {
      continue
    }
    const email = typeof account.email === 'string' && account.email ? account.email : null
    const expiresAt = typeof account.expiresAt === 'number' ? account.expiresAt : 0
    const accessToken = typeof account.accessToken === 'string' ? account.accessToken : ''
    logins.push({
      email,
      contents: JSON.stringify({
        token: {
          // agy refreshes an expired token itself; a placeholder keeps the login parseable.
          access_token: accessToken || 'expired',
          token_type: 'Bearer',
          refresh_token: account.refreshToken,
          expiry: new Date(expiresAt).toISOString(),
          expires_in: Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
        },
        auth_method: 'consumer',
        ...(email ? { id_token_email: email } : {})
      })
    })
  }
  return logins
}
