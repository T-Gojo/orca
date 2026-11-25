import { useMemo, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { AccountUsageProvider } from '../../../../shared/account-usage-ledger-types'
import { UNATTRIBUTED_ACCOUNT_KEY } from '../../../../shared/account-usage-ledger-types'
import type { TerminalAgent } from '../../../../shared/agent-status/identity/terminal-agent'
import {
  ACCOUNT_USAGE_WINDOWS,
  type AccountUsageRemoveTarget,
  type AccountUsageWindow,
  type AccountUsageWindowRow,
  type AccountUsageWindowSummary
} from '../../../../shared/account-usage-windows-types'
import { formatUsageTokens } from './usage-overview-model'
import { UsageHourlyChart } from './UsageHourlyChart'
import { UsageWindowsAccountRow } from './UsageWindowsAccountRow'
import { useAccountUsageWindows } from './use-account-usage-windows'

// Fork: Usage Windows ledger UI (1h / 5h / 7d / 30d / 90d / all) with per-CLI/account/model breakdown (FORK.md §12).

type CliWindowGroup = {
  provider: AccountUsageProvider
  rows: AccountUsageWindowRow[]
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalTokens: number
  credits: number
  estimated: boolean
}

const EMPTY_SUMMARIES: readonly AccountUsageWindowSummary[] = (
  ['1h', '5h', '7d', 'all'] as const
).map((window) => ({
  window,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  credits: 0,
  estimatedCostUsd: null,
  activity: 0,
  estimated: false
}))

function ledgerProviderAgent(provider: AccountUsageProvider): TerminalAgent {
  return provider === 'mistral' ? 'mistral-vibe' : provider
}

function providerLabel(provider: AccountUsageProvider): string {
  return (
    getAgentCatalog().find((entry) => entry.id === ledgerProviderAgent(provider))?.label ?? provider
  )
}

function windowToggleLabel(window: AccountUsageWindow, t: Translate): string {
  switch (window) {
    case '1h':
      return t('stats.usageWindows.window1h', '1h')
    case '5h':
      return t('stats.usageWindows.window5h', '5h')
    case '7d':
      return t('stats.usageWindows.window7d', '7d')
    case '30d':
      return t('stats.usageWindows.window30d', '30d')
    case '90d':
      return t('stats.usageWindows.window90d', '90d')
    case 'all':
      return t('stats.usageWindows.windowAll', 'All')
  }
}

function summaryCardLabel(window: AccountUsageWindowSummary['window'], t: Translate): string {
  switch (window) {
    case '1h':
      return t('stats.usageWindows.window1h', '1h')
    case '5h':
      return t('stats.usageWindows.window5h', '5h')
    case '7d':
      return t('stats.usageWindows.summaryWeek', 'Week (7d)')
    case 'all':
      return t('stats.usageWindows.summaryAll', 'All time')
  }
}

function formatCell(value: number, estimated: boolean, intlLocale: string): string {
  if (value <= 0) {
    return '—'
  }
  return `${estimated ? '≈' : ''}${formatUsageTokens(value, intlLocale)}`
}

function groupRowsByProvider(rows: readonly AccountUsageWindowRow[]): CliWindowGroup[] {
  const byProvider = new Map<AccountUsageProvider, AccountUsageWindowRow[]>()
  for (const row of rows) {
    byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row])
  }
  return [...byProvider.entries()]
    .map(([provider, entries]) => ({
      provider,
      rows: [...entries].sort(
        (left, right) =>
          Number(left.accountKey === UNATTRIBUTED_ACCOUNT_KEY) -
            Number(right.accountKey === UNATTRIBUTED_ACCOUNT_KEY) ||
          right.totalTokens - left.totalTokens ||
          right.credits - left.credits
      ),
      inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
      outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
      cacheTokens: entries.reduce((sum, entry) => sum + entry.cacheTokens, 0),
      totalTokens: entries.reduce((sum, entry) => sum + entry.totalTokens, 0),
      credits: entries.reduce((sum, entry) => sum + entry.credits, 0),
      estimated: entries.some((entry) => entry.estimated)
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || right.credits - left.credits)
}

function CliWindowProviderGroup({
  group,
  removingKey,
  onRemove
}: {
  group: CliWindowGroup
  removingKey: string | null
  onRemove: (target: AccountUsageRemoveTarget) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [open, setOpen] = useState(false)

  return (
    <div className="py-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-md py-2 text-left text-xs font-medium text-muted-foreground hover:bg-foreground/5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ChevronRight
                className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
              />
              <AgentIcon agent={ledgerProviderAgent(group.provider)} size={14} />
              <span className="truncate text-foreground">{providerLabel(group.provider)}</span>
              <span className="shrink-0 text-2xs font-normal text-muted-foreground">
                {t('stats.usageAccounts.accountCount', '{{count}} accounts', {
                  count: group.rows.length,
                  defaultValue_one: '{{count}} account'
                })}
              </span>
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums">
              {formatCell(group.inputTokens, group.estimated, intlLocale)}
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums">
              {formatCell(group.outputTokens, group.estimated, intlLocale)}
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums">
              {formatCell(group.cacheTokens, group.estimated, intlLocale)}
            </span>
            <span className="w-18 shrink-0 text-right tabular-nums text-foreground">
              {formatCell(group.totalTokens, group.estimated, intlLocale)}
            </span>
            <span className="w-6 shrink-0" aria-hidden />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border/40 pl-5">
            {group.rows.map((row) => (
              <UsageWindowsAccountRow
                key={`${row.provider}:${row.accountKey}`}
                row={row}
                removingKey={removingKey}
                onRemove={onRemove}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function UsageWindowsSection(): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [selectedWindow, setSelectedWindow] = useState<AccountUsageWindow>('5h')
  const { snapshot, refreshing, removingKey, refresh, removeEntry } =
    useAccountUsageWindows(selectedWindow)

  const summaries = snapshot?.summaries ?? EMPTY_SUMMARIES
  const groups = useMemo(() => groupRowsByProvider(snapshot?.rows ?? []), [snapshot?.rows])
  const showHourlyChart =
    (selectedWindow === '1h' || selectedWindow === '5h' || selectedWindow === '7d') &&
    (snapshot?.hourly.length ?? 0) > 0

  return (
    <section className="space-y-3" data-testid="usage-windows-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {t('stats.usageWindows.title', 'Usage Windows')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t(
              'stats.usageWindows.subtitle',
              'Tracked per hour, 5h, week and all time — stored until manually removed'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="xs"
            variant="outline"
            value={selectedWindow}
            aria-label={t('stats.usageWindows.windowSelector', 'Usage window')}
            onValueChange={(value) => {
              const next = ACCOUNT_USAGE_WINDOWS.find((entry) => entry === value)
              if (next) {
                setSelectedWindow(next)
              }
            }}
          >
            {ACCOUNT_USAGE_WINDOWS.map((entry) => (
              <ToggleGroupItem key={entry} value={entry}>
                {windowToggleLabel(entry, t)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={refresh}
                disabled={refreshing}
                aria-label={t('stats.usageWindows.refresh', 'Refresh usage windows')}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.components.stats.UsageOverviewPane.ca6bc5fded', 'Refresh')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((summary) => {
          const active = selectedWindow === summary.window
          return (
            <button
              key={summary.window}
              type="button"
              onClick={() => setSelectedWindow(summary.window)}
              data-testid={`usage-window-card-${summary.window}`}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                active
                  ? 'border-foreground/30 bg-accent/60'
                  : 'border-border/60 bg-card/30 hover:bg-accent/40'
              }`}
            >
              <div className="text-2xs font-medium text-muted-foreground">
                {summaryCardLabel(summary.window, t)}
              </div>
              <div className="mt-1 text-base font-semibold tabular-nums text-foreground">
                {summary.totalTokens > 0
                  ? `${summary.estimated ? '≈' : ''}${formatUsageTokens(summary.totalTokens, intlLocale)}`
                  : '0'}
              </div>
              <div className="mt-0.5 truncate text-2xs tabular-nums text-muted-foreground">
                {t('stats.usageWindows.tokenSplit', 'In {{in}} · Out {{out}} · Cache {{cache}}', {
                  in: formatUsageTokens(summary.inputTokens, intlLocale),
                  out: formatUsageTokens(summary.outputTokens, intlLocale),
                  cache: formatUsageTokens(summary.cacheTokens, intlLocale)
                })}
              </div>
            </button>
          )
        })}
      </div>

      {showHourlyChart && snapshot ? (
        <UsageHourlyChart hourly={snapshot.hourly} window={selectedWindow} />
      ) : null}

      <div className="rounded-lg border border-border/60 bg-card/30 px-4 py-2">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2 pt-1 text-2xs text-muted-foreground">
          <span className="flex-1">
            {t('stats.usageWindows.cliAccountColumn', 'CLI / Account')}
          </span>
          <span className="w-16 shrink-0 text-right">{t('stats.usageWindows.input', 'Input')}</span>
          <span className="w-16 shrink-0 text-right">
            {t('stats.usageWindows.output', 'Output')}
          </span>
          <span className="w-16 shrink-0 text-right">{t('stats.usageWindows.cache', 'Cache')}</span>
          <span className="w-18 shrink-0 text-right">{t('stats.usageWindows.total', 'Total')}</span>
          <span className="w-6 shrink-0" aria-hidden />
        </div>
        {groups.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">
            {t('stats.usageWindows.empty', 'No usage recorded in this window yet.')}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {groups.map((group) => (
              <CliWindowProviderGroup
                key={group.provider}
                group={group}
                removingKey={removingKey}
                onRemove={removeEntry}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
