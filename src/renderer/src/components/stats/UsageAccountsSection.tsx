import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { ProviderIcon } from '../status-bar/tooltip'
import { getProviderDisplayName } from '../status-bar/usage-error-copy'
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

function accountName(row: AccountUsageLedgerRow): string {
  if (row.accountKey === UNATTRIBUTED_ACCOUNT_KEY) {
    return translate(
      'auto.components.stats.UsageAccountsSection.unattributed',
      'Before account tracking'
    )
  }
  if (row.accountKey === SYSTEM_DEFAULT_ACCOUNT_KEY) {
    return translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
  }
  return (
    row.label ??
    translate('auto.components.stats.UsageAccountsSection.unknownAccount', 'Saved account')
  )
}

function AccountTokenRow({
  row,
  totalTokens
}: {
  row: AccountUsageLedgerRow
  totalTokens: number
}): React.JSX.Element {
  const share = totalTokens > 0 ? row.totalTokens / totalTokens : 0
  return (
    <div className="space-y-1.5 py-2" data-testid="usage-account-token-row">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ProviderIcon provider={row.provider} />
        <span className="min-w-0 flex-1 truncate text-foreground" title={accountName(row)}>
          {accountName(row)}
        </span>
        {row.removed ? (
          <Badge variant="outline" className="shrink-0">
            {translate('auto.components.stats.UsageAccountsSection.removed', 'Removed')}
          </Badge>
        ) : null}
        <span className="shrink-0 tabular-nums text-foreground">
          {formatUsageTokens(row.totalTokens)}
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatUsageCost(row.estimatedCostUsd)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/60"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{getProviderDisplayName(row.provider)}</span>
        <span>
          {translate(
            'auto.components.stats.UsageAccountsSection.tokenMix',
            'In {{in}} · Out {{out}} · Cache {{cache}}',
            {
              in: formatUsageTokens(row.inputTokens),
              out: formatUsageTokens(row.outputTokens),
              cache: formatUsageTokens(row.cacheTokens)
            }
          )}
        </span>
        <span>
          {translate(
            'auto.components.stats.UsageAccountsSection.activeDays',
            '{{count}} active days',
            {
              count: row.activeDays
            }
          )}
        </span>
        {row.topModel ? <span className="truncate">{row.topModel}</span> : null}
      </div>
    </div>
  )
}

/** Every account across agents: recorded token history and live plan limits. */
export function UsageAccountsSection(): React.JSX.Element {
  const claudeScanCompletedAt = useAppStore(
    (state) => state.claudeUsageScanState?.lastScanCompletedAt ?? null
  )
  const codexScanCompletedAt = useAppStore(
    (state) => state.codexUsageScanState?.lastScanCompletedAt ?? null
  )
  const [range, setRange] = useState<AccountUsageLedgerRange>('30d')
  const [snapshot, setSnapshot] = useState<AccountUsageLedgerSnapshot | null>(null)

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

  const rows = useMemo(() => (snapshot?.range === range ? snapshot.rows : []), [snapshot, range])
  const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0)

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
              'Tokens each account used, kept after an account is removed.'
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
          <div className="flex items-center justify-between py-1.5 text-xs text-muted-foreground">
            <span>
              {translate('auto.components.stats.UsageAccountsSection.tokensHeading', 'Token usage')}
            </span>
            <span className="tabular-nums">{formatUsageTokens(totalTokens)}</span>
          </div>
          {rows.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              {translate(
                'auto.components.stats.UsageAccountsSection.empty',
                'No account usage recorded yet. Enable Claude or Codex tracking and refresh.'
              )}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((row) => (
                <AccountTokenRow
                  key={`${row.provider}:${row.accountKey}`}
                  row={row}
                  totalTokens={totalTokens}
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
