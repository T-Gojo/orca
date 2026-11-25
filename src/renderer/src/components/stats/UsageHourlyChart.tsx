import { useMemo } from 'react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import type {
  AccountUsageHourlyPoint,
  AccountUsageWindow
} from '../../../../shared/account-usage-windows-types'
import { formatUsageTokens } from './usage-overview-model'

// Fork: monochrome stacked hourly token chart for 1h / 5h / 7d usage windows (FORK.md §12).

type HourlyBar = {
  hour: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalTokens: number
}

function formatHourLabel(hour: string, window: AccountUsageWindow, intlLocale: string): string {
  const date = new Date(`${hour}:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return hour
  }
  if (window === '7d') {
    return `${date.toLocaleDateString(intlLocale, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })
}

export function UsageHourlyChart({
  hourly,
  window
}: {
  hourly: readonly AccountUsageHourlyPoint[]
  window: AccountUsageWindow
}): React.JSX.Element | null {
  const t = useTranslate()
  const intlLocale = useIntlLocale()

  const bars = useMemo(() => {
    const byHour = new Map<string, HourlyBar>()
    for (const point of hourly) {
      const existing = byHour.get(point.hour) ?? {
        hour: point.hour,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0
      }
      existing.inputTokens += point.inputTokens
      existing.outputTokens += point.outputTokens
      existing.cacheTokens += point.cacheTokens
      existing.totalTokens += point.totalTokens
      byHour.set(point.hour, existing)
    }
    return [...byHour.values()].sort((left, right) => left.hour.localeCompare(right.hour))
  }, [hourly])

  if (bars.length === 0) {
    return null
  }

  const maxTokens = Math.max(1, ...bars.map((bar) => bar.totalTokens))
  const firstBar = bars[0]
  const middleBar = bars.length >= 5 ? bars[Math.floor(bars.length / 2)] : null
  const lastBar = bars.length > 1 ? (bars.at(-1) ?? null) : null

  return (
    <div
      className="rounded-md border border-border/60 bg-card/30 px-3 py-2.5"
      data-testid="usage-hourly-chart"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {t('stats.usageWindows.hourlyTitle', 'Hourly tokens')}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-xs bg-foreground/75" aria-hidden />
            {t('stats.usageWindows.input', 'Input')}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-xs bg-foreground/45" aria-hidden />
            {t('stats.usageWindows.output', 'Output')}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-xs bg-foreground/20" aria-hidden />
            {t('stats.usageWindows.cache', 'Cache')}
          </span>
        </div>
      </div>
      <div className="flex h-20 items-end gap-1">
        {bars.map((bar) => {
          const totalHeight = Math.max(
            (bar.totalTokens / maxTokens) * 100,
            bar.totalTokens > 0 ? 4 : 0
          )
          const sum = Math.max(bar.inputTokens + bar.outputTokens + bar.cacheTokens, 1)
          const cachePct = (bar.cacheTokens / sum) * 100
          const outputPct = (bar.outputTokens / sum) * 100
          const inputPct = (bar.inputTokens / sum) * 100
          const label = formatHourLabel(bar.hour, window, intlLocale)
          const tooltip = t(
            'stats.usageWindows.hourlyTooltip',
            '{{time}} · Total {{total}} · In {{in}} · Out {{out}} · Cache {{cache}}',
            {
              time: label,
              total: formatUsageTokens(bar.totalTokens, intlLocale),
              in: formatUsageTokens(bar.inputTokens, intlLocale),
              out: formatUsageTokens(bar.outputTokens, intlLocale),
              cache: formatUsageTokens(bar.cacheTokens, intlLocale)
            }
          )
          return (
            <div
              key={bar.hour}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={tooltip}
            >
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-xs"
                style={{ height: `${totalHeight}%` }}
              >
                {bar.cacheTokens > 0 ? (
                  <div className="w-full bg-foreground/20" style={{ height: `${cachePct}%` }} />
                ) : null}
                {bar.outputTokens > 0 ? (
                  <div className="w-full bg-foreground/45" style={{ height: `${outputPct}%` }} />
                ) : null}
                {bar.inputTokens > 0 ? (
                  <div className="w-full bg-foreground/75" style={{ height: `${inputPct}%` }} />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
        <span>{formatHourLabel(firstBar.hour, window, intlLocale)}</span>
        {middleBar ? <span>{formatHourLabel(middleBar.hour, window, intlLocale)}</span> : null}
        {lastBar ? <span>{formatHourLabel(lastBar.hour, window, intlLocale)}</span> : null}
      </div>
    </div>
  )
}
