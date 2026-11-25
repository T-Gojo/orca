import { createHash } from 'node:crypto'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
import { getManagedDataAccountService } from '../managed-data-accounts/service'
import { resolveOpenCodeGoApiKey } from './providers/opencode-go/opencode-go-api-key-source'
import { fetchOpenCodeGoUsage } from './providers/opencode-go/opencode-go-usage-source-selection'

// Fork: per-account OpenCode Go usage for upstream's managed data accounts (FORK.md §8/§11).
// Every account owns its credentials under its data home (`ManagedDataAccountService`), so the
// probe resolves the account's own key by launching upstream's key resolution over just that
// account's env (`environmentForAccount('opencode', id)`), then reads the same keyed usage
// endpoint the live meter uses: settings never interfere (an account row shows the account), and
// the OPENCODE_DB/XDG overlay pins each resolution to that account's store.

const FINGERPRINT_REUSE_MS = 10 * 60_000
const fingerprintByKey = new Map<string, { value: string | null; at: number }>()

function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** One store's Go key fingerprint, for the system-row matching; null when the store has no key. */
async function resolveStoreFingerprint(
  environment: NodeJS.ProcessEnv,
  cacheKey: string
): Promise<string | null> {
  const cached = fingerprintByKey.get(cacheKey)
  if (cached && Date.now() - cached.at < FINGERPRINT_REUSE_MS) {
    return cached.value
  }
  const resolution = await resolveOpenCodeGoApiKey({ environment })
  const value = resolution.status === 'found' ? keyFingerprint(resolution.key) : null
  // Why cached even when missing: the delegation table reads this on every advice brief, and a
  // missing key does not change between two reads of the same store.
  fingerprintByKey.set(cacheKey, { value, at: Date.now() })
  return value
}

/** The machine's own store: no account overlay, exactly what an unpinned `opencode` runs on. */
async function resolveSystemStoreFingerprint(): Promise<string | null> {
  return resolveStoreFingerprint({ ...process.env }, 'system')
}

/** The env OpenCode runs with on one saved account: the host env plus the account's overlay. */
function openCodeAccountEnvironment(accountId: string): NodeJS.ProcessEnv | null {
  const service = getManagedDataAccountService()
  const known = service
    .list('opencode')
    .accounts.some((account) => account.id.toLowerCase() === accountId.toLowerCase())
  if (!known) {
    return null
  }
  return { ...process.env, ...service.environmentForAccount('opencode', accountId) }
}

/** Reads one saved account's Go usage with its own key; null when it is no longer saved. */
export async function probeOpenCodeAccountUsage(
  accountId: string
): Promise<ProviderRateLimits | null> {
  const environment = openCodeAccountEnvironment(accountId)
  if (!environment) {
    return null
  }
  return fetchOpenCodeGoUsage({ environment, cookie: '' })
}

/** OpenCode's delegation table input: saved accounts, plus the machine store as `system` (FORK.md §8). */
export async function readOpenCodeDelegationAccounts(): Promise<{
  accounts: readonly { id: string; email: string | null }[]
  systemLogin: { label: string | null } | null
}> {
  const accounts = getManagedDataAccountService()
    .list('opencode')
    .accounts.map((account) => ({ id: account.id, email: account.label }))
  const systemKey = await resolveSystemStoreFingerprint()
  if (systemKey === null) {
    return { accounts, systemLogin: null }
  }
  // Mirrors Mistral's system row: only when the machine's own key matches no saved account, else
  // the saved account's row already covers it.
  for (const account of accounts) {
    const environment = openCodeAccountEnvironment(account.id)
    if (environment && (await resolveStoreFingerprint(environment, account.id)) === systemKey) {
      return { accounts, systemLogin: null }
    }
  }
  return { accounts, systemLogin: { label: null } }
}
