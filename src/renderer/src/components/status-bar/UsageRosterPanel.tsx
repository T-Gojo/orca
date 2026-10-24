import React from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'
import { translate } from '@/i18n/i18n'
import { CURSOR_MODELS_BUCKET_NAME } from '../../../../shared/cursor-usage-buckets'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  clampUsedPercent,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import { ProviderIcon } from './tooltip'
import { getProviderDisplayName } from './usage-error-copy'
import { formatPlanLabel } from './usage-roster-formatting'
import { getUsageRosterRowState, type UsageRosterRowState } from './usage-roster-row-state'
import type { StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import {
  shortLabel,
  soonestResetLabel,
  UsageMetric,
  usedSections,
  type UsageSection
} from './usage-roster-metrics'
import { UsageAccountBlock } from './UsageRosterAccountBlock'
import type { UsageRosterAccount, UsageRosterAccountsByProvider } from './usage-roster-accounts'

type ProviderId = ProviderRateLimits['provider']
export type { UsageSection }
const NO_ROSTER_ACCOUNTS: UsageRosterAccountsByProvider = {}

function providerMaxUsed(sections: UsageSection[]): number {
  return sections.length > 0
    ? Math.max(...sections.map((s) => clampUsedPercent(s.window.usedPercent)))
    : 0
}

export function getTightestUsageSection(p: ProviderRateLimits): UsageSection | null {
  const sections = usedSections(p)
  if (sections.length === 0) {
    return null
  }
  // Why: the footer promises one quiet summary per provider; choose urgency by
  // consumption even when the user displays the complementary “% left” value.
  const tightest = sections.reduce((current, candidate) =>
    clampUsedPercent(candidate.window.usedPercent) > clampUsedPercent(current.window.usedPercent)
      ? candidate
      : current
  )
  return { ...tightest, label: shortLabel(p, tightest, true) }
}

export function getUsageHeadlineSection(p: ProviderRateLimits): UsageSection | null {
  if (p.provider === 'cursor') {
    const primary = usedSections(p).find((section) => section.label === CURSOR_MODELS_BUCKET_NAME)
    if (primary) {
      return { ...primary, label: shortLabel(p, primary, true) }
    }
  }
  return getTightestUsageSection(p)
}

export function UsageRow({
  p,
  display,
  state,
  showSignInAction,
  now,
  mode = 'verbose',
  accounts
}: {
  p: ProviderRateLimits
  display: UsagePercentageDisplay
  state: UsageRosterRowState
  showSignInAction: boolean
  now: number
  mode?: StatusBarUsageMode
  accounts?: UsageRosterAccount[]
}): React.JSX.Element {
  const sections = usedSections(p)
  const hasUsage = sections.length > 0
  const name = getProviderDisplayName(p.provider)
  const plan = formatPlanLabel(p.planType)
  const showAccounts = mode === 'verbose' && (accounts?.length ?? 0) > 0
  // Why: each account block carries its own reset, so the header would only repeat the active one.
  const reset = hasUsage && !showAccounts ? soonestResetLabel(sections, now) : null
  const tightest = mode === 'compact' ? getUsageHeadlineSection(p) : null

  return (
    <div data-usage-mode={mode} className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
          <ProviderIcon provider={p.provider} />
        </span>
        <span className="min-w-0 shrink truncate text-[13px] font-medium text-foreground">
          {name}
          {plan ? <span className="font-normal text-muted-foreground"> · {plan}</span> : null}
        </span>
        {!hasUsage ? (
          <>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {state.statusLabel}
            </span>
            {showSignInAction ? (
              <span className="ml-auto shrink-0 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground">
                {translate('auto.components.status.bar.StatusBar.c35af53b73', 'Sign in')}
              </span>
            ) : null}
          </>
        ) : tightest ? (
          <span className="ml-auto">
            <UsageMetric
              section={tightest}
              label={tightest.label}
              display={display}
              showBar={false}
            />
          </span>
        ) : reset ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{reset}</span>
        ) : null}
      </div>
      {state.detail ? (
        <span className="pl-[30px] text-[11px] text-muted-foreground">{state.detail}</span>
      ) : null}
      {accounts && showAccounts ? (
        <div data-usage-accounts className="ml-[30px] flex flex-col">
          {accounts.map((account) => (
            <UsageAccountBlock key={account.key} account={account} display={display} now={now} />
          ))}
        </div>
      ) : hasUsage && mode === 'verbose' ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]">
          {sections.map((section) => (
            <UsageMetric
              key={section.label}
              section={section}
              label={shortLabel(p, section)}
              display={display}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Consolidated "Usage" popover — one row per agent (icon · name · reset ·
 * per-window bars), opened from the status-bar roster pill. Deep per-agent
 * actions route to Settings via the callbacks.
 */
export function UsageRosterPanel({
  providers,
  display,
  statusBarUsageMode,
  onStatusBarUsageModeChange,
  isRefreshing,
  onRefresh,
  onOpenProvider,
  onSignIn,
  canSignIn,
  onManageAccounts,
  onUsageDetails,
  renderRow,
  accountsByProvider = NO_ROSTER_ACCOUNTS
}: {
  providers: ProviderRateLimits[]
  display: UsagePercentageDisplay
  statusBarUsageMode: StatusBarUsageMode
  onStatusBarUsageModeChange: (mode: StatusBarUsageMode) => void
  isRefreshing: boolean
  onRefresh: () => void
  onOpenProvider: (provider: ProviderId) => void
  onSignIn: (provider: ProviderId) => void
  canSignIn: (provider: ProviderId) => boolean
  onManageAccounts: () => void
  onUsageDetails: () => void
  // Lets the host wrap a provider's row in a richer control (e.g. the
  // Claude/Codex account-switch drill-in submenu); return null to use the
  // default clickable row.
  renderRow?: (p: ProviderRateLimits, row: React.ReactNode) => React.ReactNode
  /** Claude/Codex saved accounts, listed under the provider in the Detailed view. */
  accountsByProvider?: UsageRosterAccountsByProvider
}): React.JSX.Element {
  // Why: one boundary-scheduled clock keeps every open row current without per-provider timers.
  const now = useResetCountdownClock(
    [
      ...providers,
      ...Object.values(accountsByProvider).flatMap((accounts) =>
        accounts.flatMap((account) => (account.limits ? [account.limits] : []))
      )
    ].flatMap((provider) => usedSections(provider).map((section) => section.window.resetsAt))
  )
  // Worst-first so the agent nearest a limit sits on top.
  const sorted = [...providers].sort(
    (a, b) => providerMaxUsed(usedSections(b)) - providerMaxUsed(usedSections(a))
  )

  return (
    <div className="w-[360px] text-xs">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-foreground">
          {translate('auto.components.status.bar.UsageRosterPanel.title', 'Usage')}
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-[11px]">
            {translate('auto.components.status.bar.UsageRosterPanel.allAgents', 'all agents')}
          </span>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onRefresh()
            }}
            aria-label={translate(
              'auto.components.status.bar.StatusBar.3325d996cb',
              'Refresh rate limits'
            )}
            className="size-5 justify-center p-0"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </DropdownMenuItem>
        </div>
      </div>
      {/* Density picker lives at the top of the popover it controls (view-switcher
          pattern) so both modes are named and discoverable on first open. */}
      <div className="px-3.5 pb-2.5">
        <SettingsSegmentedControl<StatusBarUsageMode>
          value={statusBarUsageMode}
          onChange={onStatusBarUsageModeChange}
          ariaLabel={translate(
            'auto.components.status.bar.UsageRosterPanel.footerDetailAria',
            'Usage footer detail'
          )}
          size="sm"
          equalWidth
          options={[
            {
              value: 'verbose',
              label: translate('auto.components.status.bar.UsageRosterPanel.detailed', 'Detailed'),
              tooltip: translate(
                'auto.components.status.bar.UsageRosterPanel.detailedTooltip',
                'Full usage with bars, labels, and percentages'
              )
            },
            {
              value: 'compact',
              label: translate('auto.components.status.bar.UsageRosterPanel.compact', 'Compact'),
              tooltip: translate(
                'auto.components.status.bar.UsageRosterPanel.compactTooltip',
                'Condensed usage: one summary per provider'
              )
            }
          ]}
        />
      </div>
      <div className="border-t border-border/70" />
      {sorted.map((p) => {
        const state = getUsageRosterRowState(p, usedSections(p).length > 0)
        const showSignInAction = state.kind === 'sign-in' && canSignIn(p.provider)
        const rowNode = (
          <UsageRow
            p={p}
            display={display}
            state={state}
            showSignInAction={showSignInAction}
            now={now}
            mode={statusBarUsageMode}
            accounts={
              p.provider === 'claude' || p.provider === 'codex'
                ? accountsByProvider[p.provider]
                : undefined
            }
          />
        )
        if (showSignInAction) {
          return (
            <DropdownMenuItem
              key={p.provider}
              onSelect={() => onSignIn(p.provider)}
              className="w-full cursor-pointer rounded-none px-3.5 py-2.5"
            >
              {rowNode}
            </DropdownMenuItem>
          )
        }
        const custom = renderRow?.(p, rowNode)
        if (custom) {
          return <React.Fragment key={p.provider}>{custom}</React.Fragment>
        }
        return (
          <DropdownMenuItem
            key={p.provider}
            onSelect={() => onOpenProvider(p.provider)}
            className="w-full cursor-pointer rounded-none px-3.5 py-2.5"
          >
            {rowNode}
          </DropdownMenuItem>
        )
      })}
      <div className="border-t border-border/70" />
      <DropdownMenuItem
        onSelect={onUsageDetails}
        className="w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5 text-[13px] text-foreground"
      >
        {translate(
          'auto.components.status.bar.UsageRosterPanel.usageDetails',
          'Usage details & history'
        )}
        <ChevronRight size={14} className="text-muted-foreground" />
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={onManageAccounts}
        className="w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5 text-[13px] text-foreground"
      >
        {translate('auto.components.status.bar.StatusBar.75ded02687', 'Manage Accounts…')}
        <ChevronRight size={14} className="text-muted-foreground" />
      </DropdownMenuItem>
    </div>
  )
}
