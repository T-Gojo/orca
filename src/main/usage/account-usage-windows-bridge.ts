import {
  ACCOUNT_USAGE_WINDOWS,
  type AccountUsageWindow,
  type AccountUsageWindowsSnapshot
} from '../../shared/account-usage-windows-types'

// Fork: Electron-free bridge exposing the desktop usage windows ledger to runtime RPCs (FORK.md §15).

export type AccountUsageWindowsReader = (
  window: AccountUsageWindow
) => Promise<AccountUsageWindowsSnapshot> | AccountUsageWindowsSnapshot

const SUMMARY_WINDOWS = ['1h', '5h', '7d', 'all'] as const

let reader: AccountUsageWindowsReader | null = null

export function setAccountUsageWindowsReader(next: AccountUsageWindowsReader | null): void {
  reader = next
}

export function emptyAccountUsageWindowsSnapshot(
  window: AccountUsageWindow
): AccountUsageWindowsSnapshot {
  const normalized = ACCOUNT_USAGE_WINDOWS.includes(window) ? window : '5h'
  return {
    window: normalized,
    updatedAt: null,
    summaries: SUMMARY_WINDOWS.map((entry) => ({
      window: entry,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      credits: 0,
      estimatedCostUsd: null,
      activity: 0,
      estimated: false
    })),
    rows: [],
    hourly: []
  }
}

export async function readAccountUsageWindowsSnapshot(
  window: AccountUsageWindow
): Promise<AccountUsageWindowsSnapshot> {
  if (!reader) {
    return emptyAccountUsageWindowsSnapshot(window)
  }
  return await reader(window)
}
