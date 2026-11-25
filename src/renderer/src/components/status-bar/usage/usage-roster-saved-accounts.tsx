import React, { createContext, useContext } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type {
  ProviderRateLimits,
  SavedAccountUsage
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { UsagePercentageDisplay } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import type { StatusBarUsageMode } from '../../../../../shared/status-bar/status-bar-usage-mode'
import type { StatusBarController } from '../composition/use-status-bar-controller'
import { useResetCountdownClock } from './useResetCountdownClock'
import { usedSections } from './usage-headline-sections'
import { UsageAccountBlock } from './UsageRosterAccountBlock'
import { SavedAccountUsageRows } from './SavedAccountUsageRows'
import type { UsageRosterAccount, UsageRosterAccountsByProvider } from './usage-roster-accounts'

type ProviderId = ProviderRateLimits['provider']
type RenderRow = (p: ProviderRateLimits, row: React.ReactNode) => React.ReactNode

export type UsageRosterSavedAccounts = {
  /** Claude/Codex saved accounts, listed under the provider in the Detailed view. */
  byProvider: UsageRosterAccountsByProvider
  /** Saved Antigravity and Kiro accounts; each opens its own usage beside the panel. */
  antigravity?: SavedAccountUsage[]
  kiro?: SavedAccountUsage[]
  mode: StatusBarUsageMode
  display: UsagePercentageDisplay
}

const UsageRosterSavedAccountsContext = createContext<UsageRosterSavedAccounts | null>(null)

export const UsageRosterSavedAccountsProvider = UsageRosterSavedAccountsContext.Provider

/** Saved logins are this desktop's, so a remote owner's usage gets no per-account rows. */
export function getUsageRosterSavedAccounts(c: StatusBarController): UsageRosterSavedAccounts {
  const view = { mode: c.statusBarUsageMode, display: c.usagePercentageDisplay }
  return c.remoteOwner
    ? { byProvider: {}, ...view }
    : {
        byProvider: c.rosterAccounts,
        antigravity: c.antigravityAccounts,
        kiro: c.kiroAccounts,
        ...view
      }
}

function singleLoginAccounts(
  saved: UsageRosterSavedAccounts,
  provider: ProviderId
): SavedAccountUsage[] | undefined {
  return provider === 'antigravity'
    ? saved.antigravity
    : provider === 'kiro'
      ? saved.kiro
      : undefined
}

function UsageAccountBlocks({
  accounts,
  display
}: {
  accounts: UsageRosterAccount[]
  display: UsagePercentageDisplay
}): React.JSX.Element {
  const t = useTranslate()
  const now = useResetCountdownClock(
    accounts.flatMap((account) =>
      account.limits ? usedSections(account.limits, t).map((s) => s.window.resetsAt) : []
    )
  )
  return (
    <div data-usage-accounts className="ml-[30px] flex flex-col">
      {accounts.map((account) => (
        <UsageAccountBlock key={account.key} account={account} display={display} now={now} />
      ))}
    </div>
  )
}

/** A Detailed row's per-account breakdown, which stands in for the provider's own window lines. */
export function useUsageRowAccounts(
  provider: ProviderId,
  mode: StatusBarUsageMode,
  display: UsagePercentageDisplay
): { node: React.ReactNode; hidesWindows: boolean } {
  const saved = useContext(UsageRosterSavedAccountsContext)
  if (!saved || mode !== 'verbose') {
    return { node: null, hidesWindows: false }
  }
  const accounts =
    provider === 'claude' || provider === 'codex' ? saved.byProvider[provider] : undefined
  if (accounts && accounts.length > 0) {
    return {
      node: <UsageAccountBlocks accounts={accounts} display={display} />,
      hidesWindows: true
    }
  }
  // Why: Antigravity/Kiro list each saved account as its own row below, which carries the windows.
  return { node: null, hidesWindows: (singleLoginAccounts(saved, provider)?.length ?? 0) > 0 }
}

function SavedAccountRowsFor({ provider }: { provider: ProviderId }): React.JSX.Element | null {
  const saved = useContext(UsageRosterSavedAccountsContext)
  if (!saved || saved.mode !== 'verbose') {
    return null
  }
  const accounts = singleLoginAccounts(saved, provider)
  return accounts && accounts.length > 0 ? (
    <SavedAccountUsageRows accounts={accounts} display={saved.display} />
  ) : null
}

/** Lists each saved Antigravity or Kiro account under its provider's row in the Detailed view. */
export function withSavedAccountRows(renderRow: RenderRow): RenderRow {
  return (p, rowNode) => {
    const row = renderRow(p, rowNode)
    return row ? (
      <>
        {row}
        <SavedAccountRowsFor provider={p.provider} />
      </>
    ) : (
      row
    )
  }
}
