import React from 'react'
import type { UsagePercentageDisplay } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import type { UsageSection } from './usage-headline-sections'
import { UsageBar, UsageValue } from './usage-meter'

/** One labelled window figure in a saved account's row. */
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
  return (
    <span data-usage-window={section.label} className="flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {showBar ? (
        <UsageBar
          usedPercent={section.window.usedPercent}
          display={display}
          className="h-[5px] w-7"
        />
      ) : null}
      <UsageValue
        usedPercent={section.window.usedPercent}
        display={display}
        className="text-[11px]"
      />
    </span>
  )
}
