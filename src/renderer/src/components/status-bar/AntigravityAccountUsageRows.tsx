import React from 'react'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'
import { translate } from '@/i18n/i18n'
import { formatWindowLabel } from '@/lib/window-label-formatter'
import type {
  AntigravityAccountUsage,
  ProviderRateLimits,
  RateLimitBucket
} from '../../../../shared/rate-limit-types'
import {
  clampUsedPercent,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import { formatTimeAgo, ProviderRateLimitWindowSection } from './tooltip'
import { getProviderUsageStatusLabel } from './usage-error-copy'
import { UsageMetric } from './usage-roster-metrics'

type BucketGroup = { name: string; buckets: RateLimitBucket[] }

// Why grouped: agy reports one pool per model family, and each family has its own windows.
function groupBuckets(limits: ProviderRateLimits | null): BucketGroup[] {
  const groups: BucketGroup[] = []
  for (const bucket of limits?.buckets ?? []) {
    const name = bucket.group ?? bucket.name
    const group = groups.find((entry) => entry.name === name)
    if (group) {
      group.buckets.push(bucket)
    } else {
      groups.push({ name, buckets: [bucket] })
    }
  }
  return groups
}

function windowTitle(bucket: RateLimitBucket): string {
  if (bucket.windowMinutes === 10080) {
    return translate('auto.components.status.bar.tooltip.252c096536', 'Weekly')
  }
  if (bucket.windowMinutes === 300) {
    return translate('auto.components.status.bar.antigravityAccounts.fiveHours', '5 hours')
  }
  return bucket.windowName ?? formatWindowLabel(bucket.windowMinutes)
}

function tightestBucket(limits: ProviderRateLimits | null): RateLimitBucket | null {
  const buckets = limits?.buckets ?? []
  return buckets.length === 0
    ? null
    : buckets.reduce((tightest, bucket) =>
        clampUsedPercent(bucket.usedPercent) > clampUsedPercent(tightest.usedPercent)
          ? bucket
          : tightest
      )
}

function accountLabel(account: AntigravityAccountUsage): string {
  return (
    account.email ??
    translate('auto.components.status.bar.antigravityAccounts.unnamed', 'Antigravity account')
  )
}

function readingCaption(account: AntigravityAccountUsage): string {
  const limits = account.rateLimits
  if (!limits || !limits.updatedAt) {
    return account.active
      ? translate('auto.components.status.bar.antigravityAccounts.notRead', 'Refresh to read usage')
      : translate(
          'auto.components.status.bar.antigravityAccounts.neverRead',
          'No reading yet. Switch to this account and refresh to read it.'
        )
  }
  const ago = formatTimeAgo(limits.updatedAt)
  return account.active
    ? translate(
        'auto.components.status.bar.antigravityAccounts.activeUpdated',
        'Active · Updated {{value0}}',
        {
          value0: ago
        }
      )
    : translate(
        'auto.components.status.bar.antigravityAccounts.lastReading',
        'Last reading {{value0}}',
        {
          value0: ago
        }
      )
}

function AccountUsagePanel({
  account,
  display
}: {
  account: AntigravityAccountUsage
  display: UsagePercentageDisplay
}): React.JSX.Element {
  const groups = groupBuckets(account.rateLimits)
  const now = useResetCountdownClock(
    groups.flatMap((group) => group.buckets.map((bucket) => bucket.resetsAt))
  )
  const limits = account.rateLimits
  return (
    <div className="w-[280px] space-y-3 p-2 text-xs">
      <div>
        <div className="truncate text-[13px] font-medium text-foreground">
          {accountLabel(account)}
        </div>
        <div className="text-muted-foreground">{readingCaption(account)}</div>
      </div>
      {groups.length === 0 && limits && limits.status !== 'ok' ? (
        <div className="text-muted-foreground">{getProviderUsageStatusLabel(limits)}</div>
      ) : null}
      {groups.map((group) => (
        <div key={group.name} className="space-y-2 border-t border-border/70 pt-3">
          <div className="font-medium text-foreground">{group.name}</div>
          {group.buckets.map((bucket) => (
            <ProviderRateLimitWindowSection
              key={bucket.name}
              window={bucket}
              label={windowTitle(bucket)}
              textClass="text-muted-foreground"
              mutedClass="text-muted-foreground"
              emptyBarClass="bg-muted"
              usagePercentageDisplay={display}
              now={now}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** One row per saved Antigravity account; hovering one opens its usage, grouped by model family. */
export function AntigravityAccountUsageRows({
  accounts,
  display
}: {
  accounts: AntigravityAccountUsage[]
  display: UsagePercentageDisplay
}): React.JSX.Element {
  return (
    <div data-antigravity-accounts className="pb-1.5">
      {accounts.map((account) => {
        const tightest = tightestBucket(account.rateLimits)
        return (
          <div key={account.accountId} className="mx-2 border-t border-border/60 first:border-t-0">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex min-w-0 flex-1 items-center gap-2 pl-[22px]">
                  <span
                    className={`min-w-0 flex-1 truncate ${account.active ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {accountLabel(account)}
                  </span>
                  {account.active ? (
                    <span className="shrink-0 rounded-sm bg-secondary px-1.5 text-[10px] font-medium text-foreground">
                      {translate('auto.components.status.bar.StatusBar.ff0fbe9311', 'Active')}
                    </span>
                  ) : null}
                  {tightest ? (
                    <UsageMetric
                      section={{ label: tightest.name, window: tightest }}
                      label={formatWindowLabel(tightest.windowMinutes)}
                      display={display}
                      showBar={false}
                    />
                  ) : null}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <AccountUsagePanel account={account} display={display} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>
        )
      })}
    </div>
  )
}
