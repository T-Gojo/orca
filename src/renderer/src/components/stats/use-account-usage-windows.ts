import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import type {
  AccountUsageRemoveTarget,
  AccountUsageWindow,
  AccountUsageWindowsSnapshot
} from '../../../../shared/account-usage-windows-types'

// Fork: loads, refreshes, and removes entries from the usage windows ledger (FORK.md §12).

export function usageRemoveKey(target: AccountUsageRemoveTarget): string {
  return `${target.provider}:${target.accountKey}:${target.model ?? ''}`
}

export function useAccountUsageWindows(usageWindow: AccountUsageWindow): {
  snapshot: AccountUsageWindowsSnapshot | null
  refreshing: boolean
  removingKey: string | null
  refresh: () => void
  removeEntry: (target: AccountUsageRemoveTarget) => void
} {
  const claudeScanCompletedAt = useAppStore(
    (state) => state.claudeUsageScanState?.lastScanCompletedAt ?? null
  )
  const codexScanCompletedAt = useAppStore(
    (state) => state.codexUsageScanState?.lastScanCompletedAt ?? null
  )
  const openCodeScanCompletedAt = useAppStore(
    (state) => state.openCodeUsageScanState?.lastScanCompletedAt ?? null
  )
  const [snapshot, setSnapshot] = useState<AccountUsageWindowsSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.accountUsage
      .getWindowsSnapshot({ window: usageWindow })
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [usageWindow, claudeScanCompletedAt, codexScanCompletedAt, openCodeScanCompletedAt])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void window.api.accountUsage
      .refreshWindows({ window: usageWindow })
      .then(setSnapshot)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [usageWindow])

  const removeEntry = useCallback(
    (target: AccountUsageRemoveTarget) => {
      const key = usageRemoveKey(target)
      setRemovingKey(key)
      void window.api.accountUsage
        .removeEntry({ target, window: usageWindow })
        .then(setSnapshot)
        .catch(() => {})
        .finally(() => {
          setRemovingKey((current) => (current === key ? null : current))
        })
    },
    [usageWindow]
  )

  return {
    snapshot: snapshot?.window === usageWindow ? snapshot : null,
    refreshing,
    removingKey,
    refresh,
    removeEntry
  }
}
