import { useMemo, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { AccountUsageLedgerRow } from '../../../../shared/account-usage-ledger-types'
import {
  SYSTEM_DEFAULT_ACCOUNT_KEY,
  UNATTRIBUTED_ACCOUNT_KEY
} from '../../../../shared/account-usage-ledger-types'
import { formatUsageCost, formatUsageTokens } from './usage-overview-model'
import { UsageAccountLimitsList } from './UsageAccountLimitsList'
import { useAccountUsageSnapshot } from './use-account-usage-snapshot'
import { estimatedTokensHint } from './usage-overview-sections'
import { useUsageFilters } from './use-usage-filters'
import { usageRangeLabel } from './UsageFilterBar'

type Largest = { tokens: number; credits: number }

function providerLabel(provider: AccountUsageLedgerRow['provider']): string {
  return getAgentCatalog().find((entry) => entry.id === provider)?.label ?? provider
}

function accountName(row: AccountUsageLedgerRow): string {
  if (row.accountKey === UNATTRIBUTED_ACCOUNT_KEY) {
    return translate('stats.usageAccounts.earlierUsage', 'Earlier usage')
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

function formatTokens(row: Pick<AccountUsageLedgerRow, 'totalTokens' | 'estimated'>): string {
  return `${row.estimated ? '≈' : ''}${formatUsageTokens(row.totalTokens)}`
}

/** Cost where the agent bills in money, credits where it bills in credits (Kiro). */
function formatAmount(cost: number | null, credits: number): string {
  if (credits > 0 && (cost === null || cost === 0)) {
    return formatCredits(credits)
  }
  return cost === null ? '—' : formatUsageCost(cost)
}

function rowDetails(row: AccountUsageLedgerRow): string {
  return [
    row.accountKey === UNATTRIBUTED_ACCOUNT_KEY
      ? translate(
          'stats.usageAccounts.earlierUsageHint',
          'Logged before Orca recorded which account was signed in'
        )
      : null,
    translate('stats.usageBreakdown.sessions', '{{count}} sessions', {
      count: row.sessions,
      defaultValue_one: '{{count}} session'
    }),
    row.activeDays === 1
      ? translate('auto.components.stats.UsageAccountsSection.activeDay', '1 active day')
      : translate(
          'auto.components.stats.UsageAccountsSection.activeDays',
          '{{count}} active days',
          {
            count: row.activeDays
          }
        ),
    row.topModel
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

function tokenMix(row: AccountUsageLedgerRow): string {
  return translate(
    'auto.components.stats.UsageAccountsSection.tokenMix',
    'In {{in}} · Out {{out}} · Cache {{cache}}',
    {
      in: formatUsageTokens(row.inputTokens),
      out: formatUsageTokens(row.outputTokens),
      cache: formatUsageTokens(row.cacheTokens)
    }
  )
}

export function AccountUsageRow({
  row,
  largest
}: {
  row: AccountUsageLedgerRow
  largest: Largest
}): React.JSX.Element {
  // Kiro bills in credits; the bar compares each row with the largest of its own unit.
  const scale = row.totalTokens > 0 ? largest.tokens : largest.credits
  const amount = row.totalTokens > 0 ? row.totalTokens : row.credits
  const share = scale > 0 ? Math.min(amount / scale, 1) : 0
  return (
    <div className="py-2.5" data-testid="usage-account-token-row" title={tokenMix(row)}>
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`min-w-0 truncate ${
              row.accountKey === UNATTRIBUTED_ACCOUNT_KEY
                ? 'text-muted-foreground'
                : 'text-foreground'
            }`}
          >
            {accountName(row)}
          </span>
          {row.removed ? (
            <Badge variant="outline" className="shrink-0">
              {translate('auto.components.stats.UsageAccountsSection.removed', 'Removed')}
            </Badge>
          ) : null}
        </span>
        <span
          className="w-20 shrink-0 text-right tabular-nums text-foreground"
          title={row.estimated ? estimatedTokensHint() : undefined}
        >
          {row.totalTokens > 0 ? formatTokens(row) : '—'}
        </span>
        <span className="w-28 shrink-0 whitespace-nowrap text-right tabular-nums text-muted-foreground">
          {formatAmount(row.estimatedCostUsd, row.credits)}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/50"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{rowDetails(row)}</p>
    </div>
  )
}

type ProviderGroup = {
  provider: AccountUsageLedgerRow['provider']
  rows: AccountUsageLedgerRow[]
  tokens: number
  credits: number
  cost: number | null
  estimated: boolean
  largest: Largest
}

/** One group per agent, busiest first; each agent's earlier usage sits below its accounts. */
function groupByProvider(rows: readonly AccountUsageLedgerRow[]): ProviderGroup[] {
  const groups = new Map<AccountUsageLedgerRow['provider'], AccountUsageLedgerRow[]>()
  for (const row of rows) {
    groups.set(row.provider, [...(groups.get(row.provider) ?? []), row])
  }
  return [...groups.entries()]
    .map(([provider, entries]) => {
      const sorted = [...entries].sort(
        (a, b) =>
          Number(a.accountKey === UNATTRIBUTED_ACCOUNT_KEY) -
            Number(b.accountKey === UNATTRIBUTED_ACCOUNT_KEY) ||
          b.totalTokens - a.totalTokens ||
          b.credits - a.credits
      )
      const costs = entries.map((row) => row.estimatedCostUsd)
      return {
        provider,
        rows: sorted,
        tokens: entries.reduce((sum, row) => sum + row.totalTokens, 0),
        credits: entries.reduce((sum, row) => sum + row.credits, 0),
        cost: costs.every((cost) => cost === null)
          ? null
          : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
        estimated: entries.some((row) => row.estimated),
        largest: {
          tokens: Math.max(0, ...entries.map((row) => row.totalTokens)),
          credits: Math.max(0, ...entries.map((row) => row.credits))
        }
      }
    })
    .sort((a, b) => b.tokens - a.tokens || b.credits - a.credits)
}

/** Fork: an agent's accounts start minimized to its totals; the chevron lists every account. */
function ProviderAccountGroup({ group }: { group: ProviderGroup }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-3 rounded-md py-2 text-left text-xs font-medium text-muted-foreground hover:bg-foreground/5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ChevronRight
                className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
              />
              <AgentIcon agent={group.provider} size={14} />
              <span className="truncate text-foreground">{providerLabel(group.provider)}</span>
              <span>
                {translate('stats.usageAccounts.accountCount', '{{count}} accounts', {
                  count: group.rows.length,
                  defaultValue_one: '{{count}} account'
                })}
              </span>
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-foreground">
              {group.tokens > 0
                ? formatTokens({ totalTokens: group.tokens, estimated: group.estimated })
                : '—'}
            </span>
            <span className="w-28 shrink-0 whitespace-nowrap text-right tabular-nums">
              {formatAmount(group.cost, group.credits)}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border/40 pl-6">
            {group.rows.map((row) => (
              <AccountUsageRow
                key={`${row.provider}:${row.accountKey}`}
                row={row}
                largest={group.largest}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** Every account across agents: recorded usage history and live plan limits. */
export function UsageAccountsSection(): React.JSX.Element {
  const { range } = useUsageFilters()
  const { snapshot, refreshing, refresh } = useAccountUsageSnapshot(range)
  const rows = useMemo(() => snapshot?.rows ?? [], [snapshot])
  const groups = useMemo(() => groupByProvider(rows), [rows])
  const totals = useMemo(
    () => ({
      tokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
      credits: rows.reduce((sum, row) => sum + row.credits, 0),
      cost: rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0)
    }),
    [rows]
  )

  return (
    <section className="space-y-3" data-testid="usage-accounts-section">
      <div>
        <h4 className="text-sm font-semibold text-foreground">
          {translate('auto.components.stats.UsageAccountsSection.title', 'Accounts')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'stats.usageAccounts.subtitle',
            'Usage per account, kept after an account is removed · {{range}}',
            { range: usageRangeLabel(range) }
          )}
        </p>
      </div>
      <div className="grid gap-4">
        <div className="rounded-lg border border-border/60 bg-card/30 px-4 py-2">
          <div className="flex items-center gap-3 border-b border-border/60 pb-2 pt-1 text-xs text-muted-foreground">
            <span className="flex-1">
              {translate('auto.components.stats.UsageAccountsSection.tokensHeading', 'Usage')}
            </span>
            <span className="tabular-nums text-foreground" data-testid="usage-accounts-total">
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
          {groups.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              {translate(
                'auto.components.stats.UsageAccountsSection.empty',
                'No usage recorded yet. Orca reads agent logs every few minutes; refresh to read them now.'
              )}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map((group) => (
                <ProviderAccountGroup key={group.provider} group={group} />
              ))}
            </div>
          )}
        </div>
        <UsageAccountLimitsList />
      </div>
    </section>
  )
}
