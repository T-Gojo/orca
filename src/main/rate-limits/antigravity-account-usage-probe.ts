import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { writeCredentialFileAtomic } from '../integration-credential-file'
import { hostShellEnvironment } from '../runtime/structured-agent-shell-environment'
import { fetchAntigravityRateLimits } from './antigravity-usage-fetcher'

export type AntigravitySavedLogins = {
  read(accountId: string): Promise<string | null>
  update(accountId: string, previous: string, next: string): Promise<void>
}

// Vault ids are randomUUID values; anything else must not name a folder.
const ACCOUNT_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

// Why an SSH session: agy then reads its file login, never the OS keyring that holds the active login.
const FILE_LOGIN_ENV = { SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' }

/**
 * Reads a saved Antigravity account's quota without switching to it: agy runs with a private home
 * whose file login is that account's saved login, removed again as soon as agy exits.
 */
export async function probeAntigravityAccountUsage(
  accountId: string,
  deps: { logins: AntigravitySavedLogins; probeRoot: string; signal?: AbortSignal }
): Promise<ProviderRateLimits | null> {
  if (!ACCOUNT_ID.test(accountId) || process.platform === 'win32') {
    return null
  }
  const saved = await deps.logins.read(accountId)
  if (!saved) {
    return null
  }
  const home = join(deps.probeRoot, accountId)
  const loginDir = join(home, '.gemini', 'antigravity-cli')
  const loginPath = join(loginDir, 'antigravity-oauth-token')
  mkdirSync(loginDir, { recursive: true, mode: 0o700 })
  writeCredentialFileAtomic(loginPath, Buffer.from(saved, 'utf8'))
  try {
    const reading = await fetchAntigravityRateLimits({
      signal: deps.signal,
      resolveEnvironment: async () => ({
        ...(await hostShellEnvironment()),
        HOME: home,
        ...FILE_LOGIN_ENV
      })
    })
    // agy refreshes the access token in place; keep the saved login as current as the one it used.
    const refreshed = existsSync(loginPath) ? readFileSync(loginPath, 'utf8') : null
    if (refreshed && refreshed !== saved) {
      await deps.logins.update(accountId, saved, refreshed).catch((error: unknown) => {
        console.warn('[rate-limits] Could not save the refreshed Antigravity login:', error)
      })
    }
    return reading
  } finally {
    rmSync(loginPath, { force: true })
  }
}
