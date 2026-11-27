import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import { useWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/useWorktreeAgentRows'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { extractBackgroundSubagents, isActiveBackgroundTaskState } from './background-task-item'

/** Fork: counts active background shells, subagents, and child workers in the active session/workspace (FORK.md §13). */
export function useActiveBackgroundTaskCount(): number {
  const currentWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const currentTabId = useAppStore((s) => s.activeTabId)
  const currentLeafId = useAppStore((s) =>
    s.activeTabId ? (s.terminalLayoutsByTabId[s.activeTabId]?.activeLeafId ?? null) : null
  )
  const rows = useWorktreeAgentRows(currentWorktreeId ?? '', Boolean(currentWorktreeId))

  return useMemo(() => {
    if (rows.length === 0) {
      return 0
    }
    const focusedPaneKey =
      currentTabId && currentLeafId ? makePaneKey(currentTabId, currentLeafId) : null
    let sessionCount = 0
    let workspaceCount = 0
    let matchedFocusedPane = false

    for (const row of rows) {
      const monitoringShells =
        row.state === 'working' && row.entry.workingMode === 'monitoring' ? 1 : 0
      const activeSubagents = extractBackgroundSubagents(row.entry).items.filter((sub) =>
        isActiveBackgroundTaskState(sub.state)
      ).length
      const delegatedWorker = row.entry.orchestration?.dispatchId && row.state !== 'done' ? 1 : 0
      const rowTasks = monitoringShells + activeSubagents + delegatedWorker
      workspaceCount += rowTasks

      if (focusedPaneKey && row.paneKey === focusedPaneKey) {
        matchedFocusedPane = true
        sessionCount += rowTasks
      } else if (currentTabId && row.paneKey.startsWith(`${currentTabId}:`)) {
        matchedFocusedPane = true
        sessionCount += rowTasks
      }
    }

    return matchedFocusedPane ? sessionCount : workspaceCount
  }, [rows, currentTabId, currentLeafId])
}
