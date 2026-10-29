import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import type {
  AccountUsageLedgerRange,
  AccountUsageLedgerSnapshot
} from '../../../../shared/account-usage-ledger-types'

/** The account ledger for one range; reloads after each Claude or Codex scan. */
export function useAccountUsageSnapshot(range: AccountUsageLedgerRange): {
  snapshot: AccountUsageLedgerSnapshot | null
  refreshing: boolean
  refresh: () => void
} {
  const claudeScanCompletedAt = useAppStore(
    (state) => state.claudeUsageScanState?.lastScanCompletedAt ?? null
  )
  const codexScanCompletedAt = useAppStore(
    (state) => state.codexUsageScanState?.lastScanCompletedAt ?? null
  )
  const [snapshot, setSnapshot] = useState<AccountUsageLedgerSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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

  const refresh = useCallback(() => {
    setRefreshing(true)
    void window.api.accountUsage
      .refresh({ range })
      .then(setSnapshot)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [range])

  return {
    snapshot: snapshot?.range === range ? snapshot : null,
    refreshing,
    refresh
  }
}
