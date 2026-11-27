import type { AgentPaneThread } from '@/components/activity/threads/activity-thread-types'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import type { BackgroundTaskItem, BackgroundTasksScope } from './background-task-item'

/** Fork: active-session selection and scope filtering for Background Tasks (FORK.md §13). */

export function selectActiveSessionThread(
  allThreads: readonly AgentPaneThread[],
  activeWorktreeId: string | null,
  activeTabId: string | null,
  activeLeafId: string | null
): AgentPaneThread | null {
  if (activeTabId && activeLeafId) {
    const exactPaneKey = makePaneKey(activeTabId, activeLeafId)
    const exact = allThreads.find((thread) => thread.paneKey === exactPaneKey)
    if (exact) {
      return exact
    }
  }
  if (activeTabId) {
    const byTab = allThreads.find((thread) => thread.tab.id === activeTabId)
    if (byTab) {
      return byTab
    }
  }
  if (!activeWorktreeId) {
    return null
  }
  const inWorktree = allThreads.filter((thread) => thread.worktree.id === activeWorktreeId)
  if (inWorktree.length === 0) {
    return null
  }
  return (
    inWorktree.find((thread) => {
      const entry = thread.currentAgentEntry ?? thread.paneEntry
      return entry?.workingMode === 'monitoring' || thread.currentAgentState !== null
    }) ?? inWorktree[0]
  )
}

export function filterBackgroundTasksByScope(
  items: readonly BackgroundTaskItem[],
  context: {
    scope: BackgroundTasksScope
    activeSessionPaneKey: string | null
    activeSessionRunId: string | null
    activeWorktreeId: string | null
    paneKeysInActiveWorktree: ReadonlySet<string>
  }
): BackgroundTaskItem[] {
  if (context.scope === 'all') {
    return [...items]
  }
  if (context.scope === 'workspace') {
    if (!context.activeWorktreeId) {
      return [...items]
    }
    return items.filter(
      (item) =>
        item.worktreeId === context.activeWorktreeId ||
        (item.ownerPaneKey !== null && context.paneKeysInActiveWorktree.has(item.ownerPaneKey))
    )
  }
  if (context.activeSessionPaneKey) {
    return items.filter(
      (item) =>
        item.ownerPaneKey === context.activeSessionPaneKey ||
        item.paneKey === context.activeSessionPaneKey ||
        (context.activeSessionRunId !== null && item.runId === context.activeSessionRunId)
    )
  }
  if (context.activeWorktreeId) {
    return items.filter((item) => item.worktreeId === context.activeWorktreeId)
  }
  return []
}
