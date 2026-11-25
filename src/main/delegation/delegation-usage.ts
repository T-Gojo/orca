import type {
  ProviderRateLimits,
  RateLimitState
} from '../../shared/agent-usage/rate-limits/rate-limit-types'
import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationUsageWindow
} from '../../shared/delegation/delegation-types'

type SavedAccount = { id: string; email: string | null }
type ManagedAccounts = { accounts: readonly SavedAccount[]; activeAccountId: string | null }

/** What the usage table is built from: the host's account lists and its last usage readings. */
export type DelegationUsageInput = {
  rateLimits: RateLimitState
  claude: ManagedAccounts
  codex: ManagedAccounts
  antigravity: readonly SavedAccount[]
  kiro: readonly SavedAccount[]
  /** Email of kiro-cli's current login, when known; it may be an account Orca has not saved. */
  kiroLoginEmail?: string | null
  /** Saved Mistral Vibe accounts; the label is the whoami customer id's short form. */
  mistral?: readonly SavedAccount[]
  /** The machine's own mistral-vibe key when it matches no saved account, for `--account system`. */
  mistralSystemLogin?: { label: string | null } | null
  maxUsedPercent: number
}

function windowsOf(limits: ProviderRateLimits | null): DelegationUsageWindow[] {
  if (!limits) {
    return []
  }
  const named = [
    ['session', limits.session],
    ['weekly', limits.weekly],
    ['monthly', limits.monthly ?? null]
  ] as const
  return named.flatMap(([name, window]) =>
    window ? [{ name, usedPercent: window.usedPercent, resetsAt: window.resetsAt }] : []
  )
}

function row(
  agent: DelegationAgent,
  account: { accountId: string | null; label: string | null; active: boolean },
  limits: ProviderRateLimits | null,
  readAt: number | null,
  maxUsedPercent: number
): DelegationAccountUsage {
  const windows = windowsOf(limits)
  const usedPercent = windows.length ? Math.max(...windows.map((w) => w.usedPercent)) : null
  const error = limits?.status === 'error' ? (limits.error ?? 'Usage could not be read') : null
  const exhausted = usedPercent !== null && usedPercent >= maxUsedPercent
  // A limit the provider reports as reached fails as an error, never as an available account.
  const limited = error !== null && /limit|quota|exhaust/i.test(error)
  return {
    agent,
    ...account,
    usedPercent,
    windows,
    readAt: limits?.updatedAt ?? readAt,
    error,
    available: !exhausted && !limited
  }
}

function managedRows(
  agent: 'claude' | 'codex',
  accounts: ManagedAccounts,
  active: ProviderRateLimits | null,
  inactive: RateLimitState['inactiveClaudeAccounts'],
  maxUsedPercent: number
): DelegationAccountUsage[] {
  const byId = new Map(inactive.map((entry) => [entry.accountId, entry]))
  const rows = [
    row(
      agent,
      { accountId: null, label: 'System default', active: accounts.activeAccountId === null },
      accounts.activeAccountId === null ? active : null,
      null,
      maxUsedPercent
    )
  ]
  for (const account of accounts.accounts) {
    const isActive = account.id === accounts.activeAccountId
    const reading = isActive ? active : (byId.get(account.id)?.rateLimits ?? null)
    rows.push(
      row(
        agent,
        { accountId: account.id, label: account.email, active: isActive },
        reading,
        byId.get(account.id)?.updatedAt ?? null,
        maxUsedPercent
      )
    )
  }
  return rows
}

function savedRows(
  agent: 'antigravity' | 'kiro' | 'mistral-vibe',
  accounts: readonly SavedAccount[],
  readings: readonly {
    accountId: string
    active: boolean
    rateLimits: ProviderRateLimits | null
  }[],
  maxUsedPercent: number
): DelegationAccountUsage[] {
  const byId = new Map(readings.map((entry) => [entry.accountId, entry]))
  return accounts.map((account) => {
    const reading = byId.get(account.id)
    return row(
      agent,
      { accountId: account.id, label: account.email, active: reading?.active ?? false },
      reading?.rateLimits ?? null,
      null,
      maxUsedPercent
    )
  })
}

/** kiro-cli's own login when it is not one of the saved accounts (the user switches it outside
 *  Orca); workers run on it with `--account system`. Only a login with a real reading counts. */
export function kiroLoginRow(
  rateLimits: Pick<RateLimitState, 'kiro' | 'kiroAccounts'>,
  email: string | null | undefined,
  maxUsedPercent: number
): DelegationAccountUsage[] {
  const limits = rateLimits.kiro
  const savedIsActive = (rateLimits.kiroAccounts ?? []).some((entry) => entry.active)
  if (!limits || savedIsActive || !windowsOf(limits).length) {
    return []
  }
  return [
    row(
      'kiro',
      { accountId: null, label: email ?? 'kiro-cli login', active: true },
      limits,
      null,
      maxUsedPercent
    )
  ]
}

/**
 * Fork: the machine's own mistral-vibe key (env, `$VIBE_HOME/.env` or keychain) when it is not one
 * of the saved accounts; workers run on it with `--account system`, which injects no
 * `MISTRAL_API_KEY`. Its usage is unread (Orca probes saved keys only), so it counts as usable.
 */
export function mistralSystemRow(
  login: { label: string | null } | null | undefined,
  maxUsedPercent: number
): DelegationAccountUsage[] {
  return login
    ? [
        row(
          'mistral-vibe',
          { accountId: null, label: login.label ?? 'System default', active: true },
          null,
          null,
          maxUsedPercent
        )
      ]
    : []
}

/** Every account each delegation agent can run on, with the share of its plan it has used. */
export function buildDelegationUsage(input: DelegationUsageInput): DelegationAccountUsage[] {
  const { rateLimits: state, maxUsedPercent } = input
  return [
    ...savedRows('antigravity', input.antigravity, state.antigravityAccounts, maxUsedPercent),
    ...savedRows('kiro', input.kiro, state.kiroAccounts ?? [], maxUsedPercent),
    ...kiroLoginRow(state, input.kiroLoginEmail, maxUsedPercent),
    ...managedRows('codex', input.codex, state.codex, state.inactiveCodexAccounts, maxUsedPercent),
    ...managedRows(
      'claude',
      input.claude,
      state.claude,
      state.inactiveClaudeAccounts,
      maxUsedPercent
    ),
    // Fork: mistral-vibe rows go last, matching its append-only spot in DELEGATION_AGENTS.
    ...savedRows('mistral-vibe', input.mistral ?? [], state.mistralAccounts ?? [], maxUsedPercent),
    ...mistralSystemRow(input.mistralSystemLogin, maxUsedPercent)
  ]
}
