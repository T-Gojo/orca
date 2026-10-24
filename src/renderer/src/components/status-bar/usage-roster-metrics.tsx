import React from 'react'
import { formatRateLimitWindowChipLabel, formatWindowLabel } from '@/lib/window-label-formatter'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../shared/rate-limit-types'
import {
  clampUsedPercent,
  getDisplayedUsagePercentage,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import { barColor, formatResetCountdown, getWindowSections } from './tooltip'
import { usageTextColorClass } from './usage-roster-formatting'

export type UsageSection = { label: string; window: RateLimitWindow }

// Windows/buckets that actually carry data — absent limits arrive as null, but a
// partial/rehydrated provider can also carry an undefined window; both must be
// dropped so downstream consumers never dereference `window.usedPercent`.
export function usedSections(p: ProviderRateLimits): UsageSection[] {
  return getWindowSections(p).filter(
    (s): s is UsageSection => s.window !== null && s.window !== undefined
  )
}

// Buckets (Gemini Flash/Pro) keep their model name; windows use their duration.
export function shortLabel(
  p: ProviderRateLimits,
  section: UsageSection,
  useRemainingDuration = false
): string {
  if (p.buckets?.some((b) => b.name === section.label)) {
    return section.label
  }
  // fableWeekly shares the 7d window with weekly; label it distinctly so the two
  // don't both render as "wk".
  if (section.window === p.fableWeekly) {
    return 'Fable'
  }
  if (p.provider === 'zcode' && section.window === p.monthly) {
    return section.label
  }
  return useRemainingDuration
    ? formatRateLimitWindowChipLabel(section.window)
    : formatWindowLabel(section.window.windowMinutes)
}

// The soonest-resetting window summarizes the agent's next reset in one line.
export function soonestResetLabel(sections: UsageSection[], now: number): string | null {
  const resets = sections
    .map((s) => s.window.resetsAt)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
  if (resets.length === 0) {
    return null
  }
  return formatResetCountdown(Math.min(...resets) - now)
}

export function UsageMetric({
  section,
  label,
  display,
  showBar = true
}: {
  section: UsageSection
  label: string
  display: UsagePercentageDisplay
  showBar?: boolean
}): React.JSX.Element {
  const used = clampUsedPercent(section.window.usedPercent)
  const shown = getDisplayedUsagePercentage(section.window.usedPercent, display)

  return (
    <span data-usage-window={section.label} className="flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {showBar ? (
        <span data-usage-bar className="h-[5px] w-7 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${barColor(used)}`}
            style={{ width: `${shown}%` }}
          />
        </span>
      ) : null}
      <span className={`tabular-nums text-[11px] ${usageTextColorClass(used)}`}>{shown}%</span>
    </span>
  )
}
