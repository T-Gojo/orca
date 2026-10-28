import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ProviderIcon, formatResetCountdown } from '../status-bar/tooltip'
import { getProviderDisplayName, getProviderUsageStatusLabel } from '../status-bar/usage-error-copy'
import { usageTextColorClass } from '../status-bar/usage-roster-formatting'
import { usedSections, shortLabel } from '../status-bar/usage-roster-metrics'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'
import { clampUsedPercent } from '../../../../shared/usage-percentage-display'
import { buildAccountLimitRows, type AccountLimitRow } from './usage-account-limits-model'

function tightestSection(row: AccountLimitRow) {
  const sections = row.limits ? usedSections(row.limits) : []
  return sections.length === 0
    ? null
    : sections.reduce((tightest, section) =>
        clampUsedPercent(section.window.usedPercent) > clampUsedPercent(tightest.window.usedPercent)
          ? section
          : tightest
      )
}

function LimitRow({ row, now }: { row: AccountLimitRow; now: number }): React.JSX.Element {
  const section = tightestSection(row)
  const used = section ? clampUsedPercent(section.window.usedPercent) : null
  const resetsAt = section?.window.resetsAt ?? null
  return (
    <div
      className="flex min-w-0 items-center gap-2 py-2 text-sm"
      data-testid="usage-account-limit-row"
    >
      <ProviderIcon provider={row.provider} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground" title={row.label}>
          {row.label}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {getProviderDisplayName(row.provider)}
          {row.active
            ? ` · ${translate('auto.components.status.bar.StatusBar.ff0fbe9311', 'Active')}`
            : ''}
          {section && row.limits ? ` · ${shortLabel(row.limits, section)}` : ''}
          {resetsAt !== null ? ` · ${formatResetCountdown(resetsAt - now)}` : ''}
        </div>
      </div>
      {used !== null ? (
        <span className={`shrink-0 tabular-nums ${usageTextColorClass(used)}`}>
          {Math.round(used)}%
        </span>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {row.limits
            ? getProviderUsageStatusLabel(row.limits)
            : translate(
                'auto.components.status.bar.antigravityAccounts.neverRead',
                'No reading yet. Refresh to read it.'
              )}
        </span>
      )}
    </div>
  )
}

/** Live plan limits for every agent and saved account, refreshed only on request. */
export function UsageAccountLimitsList(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const rateLimits = useAppStore((state) => state.rateLimits)
  const refreshRateLimits = useAppStore((state) => state.refreshRateLimits)
  const fetchInactiveClaude = useAppStore((state) => state.fetchInactiveClaudeAccountUsage)
  const fetchInactiveCodex = useAppStore((state) => state.fetchInactiveCodexAccountUsage)
  const [refreshing, setRefreshing] = useState(false)
  const rows = useMemo(
    () =>
      buildAccountLimitRows(settings, rateLimits, {
        systemDefault: translate(
          'auto.components.status.bar.StatusBar.c676918adc',
          'System default'
        ),
        savedAccount: translate('auto.components.status.bar.savedAccounts.unnamed', 'Saved account')
      }),
    [settings, rateLimits]
  )
  const now = useResetCountdownClock(
    rows.map((row) => tightestSection(row)?.window.resetsAt ?? null)
  )

  const refresh = (): void => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    void Promise.all([refreshRateLimits(), fetchInactiveClaude(), fetchInactiveCodex()]).finally(
      () => setRefreshing(false)
    )
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 px-4 py-2">
      <div className="flex items-center justify-between py-1 text-xs text-muted-foreground">
        <span>
          {translate('auto.components.stats.UsageAccountLimitsList.heading', 'Plan limits')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={refresh}
              disabled={refreshing}
              aria-label={translate(
                'auto.components.stats.UsageAccountLimitsList.refresh',
                'Refresh plan limits for every account'
              )}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.stats.UsageOverviewPane.ca6bc5fded', 'Refresh')}
          </TooltipContent>
        </Tooltip>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          {translate(
            'auto.components.stats.UsageAccountLimitsList.empty',
            'No signed-in agent reports plan limits yet.'
          )}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((row) => (
            <LimitRow key={`${row.provider}:${row.key}`} row={row} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
