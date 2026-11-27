import type { AgentPaneThread } from '@/components/activity/threads/activity-thread-types'
import { estimateBackgroundTaskEta, normalizeEtaAgentKey } from './background-task-eta'
import {
  buildBackgroundActivityLine,
  extractBackgroundSubagents,
  isActiveBackgroundTaskState,
  isStoppableBackgroundWorker,
  mapWorkerToBackgroundState,
  STATE_SORT_RANK,
  type BackgroundTaskItem,
  type BackgroundTasksScope,
  type BackgroundTaskSubagentItem,
  type MergeBackgroundTasksArgs
} from './background-task-item'
import { filterBackgroundTasksByScope } from './background-task-scope'
import {
  buildShellAndSubagentItems,
  resolveKnownAgentType,
  resolveRevealTarget
} from './background-task-shell-items'

export { filterBackgroundTasksByScope }
export type {
  BackgroundTaskItem,
  BackgroundTasksScope,
  BackgroundTaskSubagentItem,
  MergeBackgroundTasksArgs
}

/** Fork: merges delegated workers, session background shells, and subagents (FORK.md §13). */

export function mergeBackgroundTasks(args: MergeBackgroundTasksArgs): BackgroundTaskItem[] {
  const {
    shells,
    threads,
    workers,
    priorsByAgent,
    globalPrior,
    worktreeNameById,
    repoNameByWorktreeId,
    nowMs
  } = args

  const threadByPaneKey = new Map<string, AgentPaneThread>()
  const threadByDispatchId = new Map<string, AgentPaneThread>()
  for (const thread of threads) {
    threadByPaneKey.set(thread.paneKey, thread)
    const dispatchId = (thread.currentAgentEntry ?? thread.paneEntry)?.orchestration?.dispatchId
    if (dispatchId) {
      threadByDispatchId.set(dispatchId, thread)
    }
  }

  const workerPaneKeys = new Set<string>()
  const activeWorkerOwnerPanes = new Set<string>()
  const items: BackgroundTaskItem[] = []

  for (const worker of workers) {
    const workerThread =
      threadByDispatchId.get(worker.dispatchId) ??
      (worker.paneKey ? threadByPaneKey.get(worker.paneKey) : undefined)
    if (worker.paneKey) {
      workerPaneKeys.add(worker.paneKey)
    }
    if (workerThread) {
      workerPaneKeys.add(workerThread.paneKey)
    }
    const entry = workerThread?.currentAgentEntry ?? workerThread?.paneEntry
    const state = mapWorkerToBackgroundState(worker)
    const isActive = isActiveBackgroundTaskState(state)
    if (isActive && worker.creatorPaneKey) {
      activeWorkerOwnerPanes.add(worker.creatorPaneKey)
    }
    const agentType =
      (workerThread?.agentType && workerThread.agentType !== 'unknown'
        ? workerThread.agentType
        : null) ?? resolveKnownAgentType(worker.agent)
    const normalizedAgent = normalizeEtaAgentKey(agentType)
    const worktreeId = worker.worktreeId ?? workerThread?.worktree.id ?? null
    const { items: subagents, counts: subagentCounts } = extractBackgroundSubagents(entry)
    const updatedAt = Math.max(worker.updatedAt, entry?.updatedAt ?? 0)

    items.push({
      id: `dispatch:${worker.dispatchId}`,
      kind: 'worker',
      paneKey: worker.paneKey ?? workerThread?.paneKey ?? null,
      ownerPaneKey: worker.creatorPaneKey ?? worker.paneKey ?? null,
      worktreeId,
      title:
        worker.displayName?.trim() ||
        worker.taskTitle?.trim() ||
        worker.objective?.trim() ||
        worker.dispatchId,
      agentType,
      normalizedAgent,
      model: entry?.model ?? worker.model,
      account: worker.account,
      state,
      isActive,
      workspaceName:
        workerThread?.worktree.displayName ||
        workerThread?.worktree.branch ||
        (worktreeId ? (worktreeNameById.get(worktreeId) ?? null) : null),
      repoName:
        workerThread?.repo?.displayName ??
        (worktreeId ? (repoNameByWorktreeId.get(worktreeId) ?? null) : null),
      activityLine: buildBackgroundActivityLine(entry, worker),
      outputTail: null,
      progressLabel: null,
      cpuPercent: null,
      pid: null,
      stage: worker.stage,
      lastError: worker.lastError,
      startedAt: worker.startedAt,
      updatedAt,
      completedAt: worker.completedAt,
      eta: estimateBackgroundTaskEta({
        state,
        agentType,
        startedAt: worker.startedAt,
        updatedAt,
        nowMs,
        stage: worker.stage,
        stateHistory: entry?.stateHistory,
        subagentCounts,
        agentPrior: normalizedAgent ? (priorsByAgent[normalizedAgent] ?? null) : null,
        globalPrior,
        hasBackgroundWait: entry?.workingMode === 'monitoring'
      }),
      dispatchId: worker.dispatchId,
      runId: worker.runId,
      messageCount: worker.messageCount,
      canStop: isStoppableBackgroundWorker(worker),
      subagents,
      revealTarget: resolveRevealTarget(workerThread)
    })
  }

  items.push(
    ...buildShellAndSubagentItems({
      shells,
      threads,
      threadByPaneKey,
      workerPaneKeys,
      activeWorkerOwnerPanes,
      priorsByAgent,
      globalPrior,
      worktreeNameById,
      repoNameByWorktreeId,
      nowMs
    })
  )

  items.sort((left, right) => {
    const rankDelta = STATE_SORT_RANK[left.state] - STATE_SORT_RANK[right.state]
    return rankDelta !== 0 ? rankDelta : right.updatedAt - left.updatedAt
  })
  return items
}
