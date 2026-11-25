import React from 'react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import type { UsagePercentageDisplay } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import { getProviderUsageStatusLabel } from '../../../../../shared/agent-usage/status-copy/usage-error-copy'
import type { UsageRosterAccount } from './usage-roster-accounts'
import { shortUsageLabel, usedSections } from './usage-headline-sections'
import { soonestResetLabel } from './usage-reset-caption'
import { UsageMetric } from './usage-roster-metrics'

export function UsageAccountBlock({
  account,
  display,
  now
}: {
  account: UsageRosterAccount
  display: UsagePercentageDisplay
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const limits = account.limits
  const sections = limits ? usedSections(limits, t) : []
  // Why: the provider row above already shows the active account's reset.
  const reset =
    sections.length > 0 && !account.active ? soonestResetLabel(sections, now, intlLocale, t) : null
  const status =
    sections.length > 0
      ? null
      : account.isFetching
        ? t('auto.components.status.bar.UsageRosterPanel.accountLoading', 'Loading…')
        : limits
          ? getProviderUsageStatusLabel(limits, t)
          : t(
              'auto.components.status.bar.UsageRosterPanel.accountNotLoaded',
              'Refresh to load usage'
            )

  return (
    <div
      data-usage-account={account.key}
      className="flex flex-col gap-1 border-t border-border/60 py-1.5 first:border-t-0 first:pt-0.5 last:pb-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${account.active ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {account.label}
        </span>
        {account.active ? (
          <span className="shrink-0 rounded-sm bg-secondary px-1.5 text-[10px] font-medium text-foreground">
            {t('auto.components.status.bar.StatusBar.ff0fbe9311', 'Active')}
          </span>
        ) : null}
        {reset ? <span className="shrink-0 text-[10px] text-muted-foreground">{reset}</span> : null}
      </div>
      {limits && sections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {sections.map((section) => (
            <UsageMetric
              key={section.label}
              section={section}
              label={shortUsageLabel(limits, section, false, t)}
              display={display}
            />
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground">{status}</span>
      )}
    </div>
  )
}
