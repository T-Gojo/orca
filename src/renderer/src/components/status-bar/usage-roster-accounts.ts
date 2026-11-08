import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitState
} from '../../../../shared/rate-limit-types'

export type UsageRosterAccount = {
  key: string
  label: string
  active: boolean
  limits: ProviderRateLimits | null
  isFetching: boolean
}

export type UsageRosterAccountsByProvider = Partial<
  Record<Extract<ProviderRateLimits['provider'], 'claude' | 'codex'>, UsageRosterAccount[]>
>

type AccountIdentity = { id: string; label: string }

export type UsageRosterAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'codexManagedAccounts'
  | 'activeCodexManagedAccountId'
  | 'activeCodexManagedAccountIdsByRuntime'
>

function buildAccounts(
  identities: AccountIdentity[],
  activeId: string | null,
  activeLimits: ProviderRateLimits | null,
  inactive: InactiveAccountUsage[],
  systemDefaultLabel: string
): UsageRosterAccount[] {
  const active = identities.find((account) => account.id === activeId)
  const rows: UsageRosterAccount[] = [
    {
      key: active?.id ?? 'system-default',
      label: active?.label ?? systemDefaultLabel,
      active: true,
      limits: activeLimits,
      isFetching: activeLimits?.status === 'fetching'
    }
  ]
  for (const account of identities) {
    if (account.id === active?.id) {
      continue
    }
    const usage = inactive.find((entry) => entry.accountId === account.id)
    rows.push({
      key: account.id,
      label: account.label,
      active: false,
      limits: usage?.rateLimits ?? null,
      isFetching: usage?.isFetching ?? false
    })
  }
  // Why: a lone account is already the provider row; the breakdown only earns space with two or more.
  return rows.length > 1 ? rows : []
}

function withDetail(email: string, detail: string | null | undefined): string {
  return detail ? `${email} · ${detail}` : email
}

/** Host accounts only: WSL-owned accounts are attributed to a different usage target. */
export function buildUsageRosterAccounts(
  settings: UsageRosterAccountSettings | null | undefined,
  rateLimits: RateLimitState,
  systemDefaultLabel: string
): UsageRosterAccountsByProvider {
  if (!settings) {
    return {}
  }
  const result: UsageRosterAccountsByProvider = {}
  if (rateLimits.claudeTarget.runtime === 'host') {
    const claude = buildAccounts(
      settings.claudeManagedAccounts
        .filter((account) => account.managedAuthRuntime !== 'wsl')
        .map((account) => ({
          id: account.id,
          label: withDetail(account.email, account.organizationName)
        })),
      settings.activeClaudeManagedAccountIdsByRuntime?.host ??
        settings.activeClaudeManagedAccountId ??
        null,
      rateLimits.claude,
      rateLimits.inactiveClaudeAccounts,
      systemDefaultLabel
    )
    if (claude.length > 0) {
      result.claude = claude
    }
  }
  if (rateLimits.codexTarget.runtime === 'host') {
    const codex = buildAccounts(
      settings.codexManagedAccounts
        .filter((account) => account.managedHomeRuntime !== 'wsl')
        .map((account) => ({
          id: account.id,
          label: withDetail(account.email, account.workspaceLabel)
        })),
      settings.activeCodexManagedAccountIdsByRuntime?.host ??
        settings.activeCodexManagedAccountId ??
        null,
      rateLimits.codex,
      rateLimits.inactiveCodexAccounts,
      systemDefaultLabel
    )
    if (codex.length > 0) {
      result.codex = codex
    }
  }
  return result
}
