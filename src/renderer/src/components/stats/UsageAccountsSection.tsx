import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type {
  AccountUsageLedgerRange,
  AccountUsageLedgerRow,
  AccountUsageLedgerSnapshot
} from '../../../../shared/account-usage-ledger-types'
import {
  SYSTEM_DEFAULT_ACCOUNT_KEY,
  UNATTRIBUTED_ACCOUNT_KEY
} from '../../../../shared/account-usage-ledger-types'
import { formatUsageCost, formatUsageTokens } from './usage-overview-model'
import { UsageAccountLimitsList } from './UsageAccountLimitsList'

const RANGES: readonly AccountUsageLedgerRange[] = ['7d', '30d', '90d', 'all']

function rangeLabel(range: AccountUsageLedgerRange): string {
  return range === 'all'
    ? translate('auto.components.stats.UsageAccountsSection.allTime', 'All time')
    : range
}

function providerLabel(provider: AccountUsageLedgerRow['provider']): string {
  return getAgentCatalog().find((entry) => entry.id === provider)?.label ?? provider
}

function accountName(row: AccountUsageLedgerRow): string {
  if (row.accountKey === UNATTRIBUTED_ACCOUNT_KEY) {
    return translate(
      'auto.components.stats.UsageAccountsSection.unattributed',
      'Before account tracking'
    )
  }
  if (row.accountKey === SYSTEM_DEFAULT_ACCOUNT_KEY && !row.label) {
    return translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
  }
  return (
    row.label ??
    translate('auto.components.stats.UsageAccountsSection.unknownAccount', 'Saved account')
  )
}

function formatCredits(value: number): string {
  return translate('auto.components.stats.UsageAccountsSection.credits', '{{value}} credits', {
    value: value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)
  })
}

/** Kiro bills in credits; the bar compares each row with the largest of its own unit. */
function rowAmount(row: AccountUsageLedgerRow): number {
  return row.totalTokens > 0 ? row.totalTokens : row.credits
}

function AccountUsageRow({
  row,
  largest
}: {
  row: AccountUsageLedgerRow
  largest: { tokens: number; credits: number }
}): React.JSX.Element {
  const scale = row.totalTokens > 0 ? largest.tokens : largest.credits
  const share = scale > 0 ? rowAmount(row) / scale : 0
  const details = [
    providerLabel(row.provider),
    row.totalTokens > 0
      ? translate(
          'auto.components.stats.UsageAccountsSection.tokenMix',
          'In {{in}} · Out {{out}} · Cache {{cache}}',
          {
            in: formatUsageTokens(row.inputTokens),
            out: formatUsageTokens(row.outputTokens),
            cache: formatUsageTokens(row.cacheTokens)
          }
        )
      : null,
    row.credits > 0 && row.totalTokens > 0 ? formatCredits(row.credits) : null,
    translate('auto.components.stats.UsageAccountsSection.sessions', '{{count}} sessions', {
      count: row.sessions
    }),
    translate('auto.components.stats.UsageAccountsSection.activeDays', '{{count}} active days', {
      count: row.activeDays
    }),
    row.topModel
  ].filter((part): part is string => Boolean(part))
  return (
    <div className="space-y-1.5 py-2" data-testid="usage-account-token-row">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <AgentIcon agent={row.provider} size={14} />
        <span className="min-w-0 flex-1 truncate text-foreground" title={accountName(row)}>
          {accountName(row)}
        </span>
        {row.removed ? (
          <Badge variant="outline" className="shrink-0">
            {translate('auto.components.stats.UsageAccountsSection.removed', 'Removed')}
          </Badge>
        ) : null}
        <span className="shrink-0 tabular-nums text-foreground">
          {row.totalTokens > 0 ? formatUsageTokens(row.totalTokens) : formatCredits(row.credits)}
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatUsageCost(row.estimatedCostUsd)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/60"
          style={{ width: `${Math.min(share, 1) * 100}%` }}
        />
      </div>
      <div className="truncate text-xs text-muted-foreground" title={details.join(' · ')}>
        {details.join(' · ')}
      </div>
    </div>
  )
}

/** Every account across agents: recorded usage history and live plan limits. */
export function UsageAccountsSection(): React.JSX.Element {
  const claudeScanCompletedAt = useAppStore(
    (state) => state.claudeUsageScanState?.lastScanCompletedAt ?? null
  )
  const codexScanCompletedAt = useAppStore(
    (state) => state.codexUsageScanState?.lastScanCompletedAt ?? null
  )
  const [range, setRange] = useState<AccountUsageLedgerRange>('30d')
  const [snapshot, setSnapshot] = useState<AccountUsageLedgerSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.accountUsage
      .getSnapshot({ range })
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [range, claudeScanCompletedAt, codexScanCompletedAt])

  const refresh = (): void => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    void window.api.accountUsage
      .refresh({ range })
      .then(setSnapshot)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }

  const rows = useMemo(() => (snapshot?.range === range ? snapshot.rows : []), [snapshot, range])
  const totals = useMemo(
    () => ({
      tokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
      credits: rows.reduce((sum, row) => sum + row.credits, 0),
      cost: rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0),
      largest: {
        tokens: Math.max(0, ...rows.map((row) => row.totalTokens)),
        credits: Math.max(0, ...rows.map((row) => row.credits))
      }
    }),
    [rows]
  )

  return (
    <section className="space-y-3" data-testid="usage-accounts-section">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.UsageAccountsSection.title', 'Accounts')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.stats.UsageAccountsSection.subtitle',
              'Usage per account across every agent, kept after an account is removed.'
            )}
          </p>
        </div>
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
              {rangeLabel(entry)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card/30 px-4 py-2">
          <div className="flex items-center justify-between gap-2 py-1 text-xs text-muted-foreground">
            <span>
              {translate('auto.components.stats.UsageAccountsSection.tokensHeading', 'Usage')}
            </span>
            <span className="ml-auto tabular-nums" data-testid="usage-accounts-total">
              {[
                formatUsageTokens(totals.tokens),
                totals.credits > 0 ? formatCredits(totals.credits) : null,
                totals.cost > 0 ? formatUsageCost(totals.cost) : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
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
                <AccountUsageRow
                  key={`${row.provider}:${row.accountKey}`}
                  row={row}
                  largest={totals.largest}
                />
              ))}
            </div>
          )}
        </div>
        <UsageAccountLimitsList />
      </div>
    </section>
  )
}
