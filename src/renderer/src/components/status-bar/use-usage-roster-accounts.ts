import { useCallback } from 'react'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import {
  buildUsageRosterAccounts,
  type UsageRosterAccountsByProvider
} from './usage-roster-accounts'

/** Per-account rows for the Detailed usage view, and the manual refresh that fills them. */
export function useUsageRosterAccounts(
  remoteOwned: boolean,
  localRateLimits: RateLimitState
): {
  rosterAccounts: UsageRosterAccountsByProvider
  refreshAccountUsage: () => Promise<void>
} {
  const settings = useAppStore((s) => s.settings)
  const fetchInactiveClaudeAccountUsage = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const fetchInactiveCodexAccountUsage = useAppStore((s) => s.fetchInactiveCodexAccountUsage)
  // Why: the Detailed view lists every saved account, so a manual refresh reads them all.
  const refreshAccountUsage = useCallback(async () => {
    if (remoteOwned) {
      return
    }
    await Promise.all([fetchInactiveClaudeAccountUsage(), fetchInactiveCodexAccountUsage()])
  }, [remoteOwned, fetchInactiveClaudeAccountUsage, fetchInactiveCodexAccountUsage])
  // Why: local settings name this desktop's accounts, so a remote owner's usage gets no breakdown.
  const rosterAccounts = remoteOwned
    ? {}
    : buildUsageRosterAccounts(
        settings,
        localRateLimits,
        translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
      )
  return { rosterAccounts, refreshAccountUsage }
}
