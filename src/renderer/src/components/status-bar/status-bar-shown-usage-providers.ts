import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { StatusBarItem } from '../../../../shared/ui-chrome-types'
import { isStatusBarItemAvailable } from './status-bar-agent-gating'

type UsageProviderId = ProviderRateLimits['provider'] & StatusBarItem

export type UsageMeterCandidate = {
  id: UsageProviderId
  limits: ProviderRateLimits | null | undefined
  /** Usage readable without the CLI on PATH (web credentials, IDE logins, saved keys). */
  readableWithoutCli?: boolean
}

/** The usage meters the status bar shows, in candidate order. */
export function getShownUsageProviders(
  candidates: UsageMeterCandidate[],
  visible: (
    id: UsageProviderId,
    limits: ProviderRateLimits | null | undefined
  ) => ProviderRateLimits | null,
  statusBarItems: readonly StatusBarItem[],
  detectedAgentIds: TuiAgent[] | null
): ProviderRateLimits[] {
  return candidates.flatMap(({ id, limits, readableWithoutCli }) => {
    const shown = visible(id, limits)
    const available = readableWithoutCli || isStatusBarItemAvailable(id, detectedAgentIds)
    return shown !== null && statusBarItems.includes(id) && available ? [shown] : []
  })
}
