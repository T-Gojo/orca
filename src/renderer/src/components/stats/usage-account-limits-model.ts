import type {
  ProviderRateLimits,
  RateLimitState,
  SavedAccountUsage
} from '../../../../shared/rate-limit-types'
import {
  buildUsageRosterAccounts,
  type UsageRosterAccountSettings
} from '../status-bar/usage-roster-accounts'
import { isUsageProviderHidden } from '../status-bar/usage-provider-connection'

export type AccountLimitRow = {
  provider: ProviderRateLimits['provider']
  key: string
  label: string
  active: boolean
  limits: ProviderRateLimits | null
}

type SingleAccountProvider = Exclude<
  ProviderRateLimits['provider'],
  'claude' | 'codex' | 'antigravity' | 'kiro'
>

const SINGLE_ACCOUNT_PROVIDERS: readonly {
  provider: SingleAccountProvider
  read: (state: RateLimitState) => ProviderRateLimits | null
}[] = [
  { provider: 'gemini', read: (state) => state.gemini },
  { provider: 'grok', read: (state) => state.grok },
  { provider: 'cursor', read: (state) => state.cursor },
  { provider: 'opencode-go', read: (state) => state.opencodeGo },
  { provider: 'kimi', read: (state) => state.kimi },
  { provider: 'minimax', read: (state) => state.minimax },
  { provider: 'zcode', read: (state) => state.zcode }
]

// Why: an unconfigured provider only reports "unavailable"; listing it would read as a failure.
function isConfigured(limits: ProviderRateLimits | null): limits is ProviderRateLimits {
  return limits !== null && limits.status !== 'unavailable' && limits.status !== 'idle'
}

function savedAccountRows(
  provider: 'antigravity' | 'kiro',
  saved: SavedAccountUsage[] | undefined,
  live: ProviderRateLimits | null,
  savedAccountLabel: string
): AccountLimitRow[] {
  if (saved && saved.length > 0) {
    return saved.map((account) => ({
      provider,
      key: account.accountId,
      label: account.email ?? savedAccountLabel,
      active: account.active,
      limits: account.rateLimits
    }))
  }
  return isConfigured(live)
    ? [{ provider, key: 'active', label: savedAccountLabel, active: true, limits: live }]
    : []
}

function activeLabel(
  accounts: readonly { id: string; email: string }[],
  activeId: string | null | undefined,
  fallback: string
): string {
  return accounts.find((account) => account.id === activeId)?.email ?? fallback
}

/** Every provider's plan limits, one row per saved account, in one list. */
export function buildAccountLimitRows(
  settings: UsageRosterAccountSettings | null | undefined,
  rateLimits: RateLimitState,
  labels: { systemDefault: string; savedAccount: string },
  disabledAgents?: Iterable<unknown> | null
): AccountLimitRow[] {
  return collectAccountLimitRows(settings, rateLimits, labels).filter(
    (row) => !isUsageProviderHidden(row.provider, row.limits, disabledAgents)
  )
}

function collectAccountLimitRows(
  settings: UsageRosterAccountSettings | null | undefined,
  rateLimits: RateLimitState,
  labels: { systemDefault: string; savedAccount: string }
): AccountLimitRow[] {
  const roster = buildUsageRosterAccounts(settings, rateLimits, labels.systemDefault)
  const rows: AccountLimitRow[] = []
  for (const provider of ['claude', 'codex'] as const) {
    const accounts = roster[provider]
    if (accounts) {
      rows.push(
        ...accounts.map((account) => ({
          provider,
          key: account.key,
          label: account.label,
          active: account.active,
          limits: account.limits
        }))
      )
      continue
    }
    const live = rateLimits[provider]
    if (isConfigured(live)) {
      const label =
        provider === 'claude'
          ? activeLabel(
              settings?.claudeManagedAccounts ?? [],
              settings?.activeClaudeManagedAccountIdsByRuntime?.host ??
                settings?.activeClaudeManagedAccountId,
              labels.systemDefault
            )
          : activeLabel(
              settings?.codexManagedAccounts ?? [],
              settings?.activeCodexManagedAccountIdsByRuntime?.host ??
                settings?.activeCodexManagedAccountId,
              labels.systemDefault
            )
      rows.push({ provider, key: 'active', label, active: true, limits: live })
    }
  }
  rows.push(
    ...savedAccountRows(
      'antigravity',
      rateLimits.antigravityAccounts,
      rateLimits.antigravity,
      labels.savedAccount
    ),
    ...savedAccountRows('kiro', rateLimits.kiroAccounts, rateLimits.kiro, labels.savedAccount)
  )
  for (const { provider, read } of SINGLE_ACCOUNT_PROVIDERS) {
    const live = read(rateLimits)
    if (isConfigured(live)) {
      rows.push({ provider, key: 'active', label: labels.savedAccount, active: true, limits: live })
    }
  }
  return rows
}
