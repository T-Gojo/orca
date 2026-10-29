import { useMemo, useState } from 'react'
import { CalendarDays, Coins, RefreshCw, Sparkles, Activity } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { StatCard } from './StatCard'
import type { AccountUsageLedgerRange } from '../../../../shared/account-usage-ledger-types'
import { buildDailyOverview, getRecentUsageDays } from './usage-overview-daily-series'
import { formatUsageTokens } from './usage-overview-model'
import { DailyIntensityGrid, estimatedTokensHint } from './usage-overview-sections'
import type { LedgerOnlyProviderId } from './usage-overview-types'
import { AccountUsageRow } from './UsageAccountsSection'
import { useAccountUsageSnapshot } from './use-account-usage-snapshot'

const RANGES: readonly AccountUsageLedgerRange[] = ['7d', '30d', '90d', 'all']
const RECENT_DAY_COUNT = 42

/** One agent read from its session logs (Kiro, Antigravity), split by account. */
export function LedgerProviderUsagePane({
  provider,
  label
}: {
  provider: LedgerOnlyProviderId
  label: string
}): React.JSX.Element {
  const [range, setRange] = useState<AccountUsageLedgerRange>('30d')
  const { snapshot, refreshing, refresh } = useAccountUsageSnapshot(range)
  const rows = useMemo(
    () => snapshot?.rows.filter((row) => row.provider === provider) ?? [],
    [snapshot, provider]
  )
  const daily = useMemo(
    () =>
      buildDailyOverview({
        claude: { scanState: null, summary: null, daily: [] },
        codex: { scanState: null, summary: null, daily: [] },
        opencode: { scanState: null, summary: null, daily: [] },
        muse: { scanState: null, summary: null, daily: [] },
        ledger: {
          rows,
          daily: snapshot?.daily.filter((entry) => entry.provider === provider) ?? []
        }
      }),
    [rows, snapshot, provider]
  )
  const bestDay = daily.reduce<(typeof daily)[number] | null>(
    (best, entry) => (!best || entry.totalTokens > best.totalTokens ? entry : best),
    null
  )
  const tokens = rows.reduce((sum, row) => sum + row.totalTokens, 0)
  const credits = rows.reduce((sum, row) => sum + row.credits, 0)
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0)
  const estimated = rows.some((row) => row.estimated)
  const largest = {
    tokens: Math.max(0, ...rows.map((row) => row.totalTokens)),
    credits: Math.max(0, ...rows.map((row) => row.credits))
  }

  return (
    <div className="space-y-4" data-testid={`ledger-usage-pane-${provider}`}>
      <section className="rounded-lg border border-border/60 bg-card/30 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {translate(
                'auto.components.stats.LedgerProviderUsagePane.title',
                '{{value0}} usage',
                {
                  value0: label
                }
              )}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {estimated
                ? estimatedTokensHint()
                : translate(
                    'auto.components.stats.LedgerProviderUsagePane.source',
                    'Read from this agent’s local session logs.'
                  )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={range}
              onValueChange={(value) => {
                const next = RANGES.find((entry) => entry === value)
                if (next) {
                  setRange(next)
                }
              }}
            >
              {RANGES.map((entry) => (
                <ToggleGroupItem key={entry} value={entry}>
                  {entry === 'all'
                    ? translate('auto.components.stats.UsageAccountsSection.allTime', 'All time')
                    : entry}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refresh}
                  disabled={refreshing}
                  aria-label={translate(
                    'auto.components.stats.UsageAccountsSection.refresh',
                    'Read every agent’s usage now'
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
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={translate('auto.components.stats.UsageOverviewPane.3887b94ce5', 'Total tokens')}
            value={`${estimated ? '≈' : ''}${formatUsageTokens(tokens)}`}
            icon={<Sparkles className="size-4" />}
          />
          <StatCard
            label={translate('auto.components.stats.LedgerProviderUsagePane.credits', 'Credits')}
            value={credits > 0 ? Math.round(credits).toLocaleString() : 'n/a'}
            icon={<Coins className="size-4" />}
          />
          <StatCard
            label={translate('auto.components.stats.LedgerProviderUsagePane.sessions', 'Sessions')}
            value={sessions.toLocaleString()}
            icon={<Activity className="size-4" />}
          />
          <StatCard
            label={translate('auto.components.stats.UsageOverviewPane.327603fe8b', 'Active days')}
            value={new Set(
              daily.filter((entry) => entry.totalTokens > 0).map((entry) => entry.day)
            ).size.toLocaleString()}
            icon={<CalendarDays className="size-4" />}
          />
        </div>
        <div className="mt-4">
          <DailyIntensityGrid
            days={getRecentUsageDays(daily, RECENT_DAY_COUNT)}
            bestDay={bestDay}
          />
        </div>
      </section>
      <section className="rounded-lg border border-border/60 bg-card/30 px-4 py-2">
        {rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {translate(
              'auto.components.stats.UsageAccountsSection.empty',
              'No usage recorded yet. Orca reads agent logs every few minutes; refresh to read them now.'
            )}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((row) => (
              <AccountUsageRow key={row.accountKey} row={row} largest={largest} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
