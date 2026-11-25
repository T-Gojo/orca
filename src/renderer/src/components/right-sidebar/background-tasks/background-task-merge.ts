import type { BackgroundTaskWorkerRecord } from '../../../../../shared/delegation/background-tasks-types'
import type { AgentType } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { DashboardRevealAgentArgs } from '../../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { AgentPaneThread } from '@/components/activity/threads/activity-thread-types'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { estimateBackgroundTaskEta, normalizeEtaAgentKey } from './background-task-eta'
import {
  buildBackgroundActivityLine,
  extractBackgroundSubagents,
  isActiveBackgroundTaskState,
  isStoppableBackgroundWorker,
  mapThreadToBackgroundState,
  mapWorkerToBackgroundState,
  STATE_SORT_RANK,
  type BackgroundTaskItem,
  type BackgroundTaskSubagentItem,
  type MergeBackgroundTasksArgs
} from './background-task-item'

export type { BackgroundTaskItem, BackgroundTaskSubagentItem, MergeBackgroundTasksArgs }

/** Fork: merges live agent pane threads with durable orchestration worker records (FORK.md §13). */

function resolveKnownAgentType(agent: string | null | undefined): AgentType | null {
  if (!agent) {
    return null
  }
  if (agent === 'dsb' || agent === 'unknown') {
    return agent
  }
  return getAgentCatalog().find((entry) => entry.id === agent)?.id ?? null
}

function resolveRevealTarget(thread: AgentPaneThread): DashboardRevealAgentArgs | null {
  if (!thread.worktree.id || !thread.tab.id) {
    return null
  }
  return {
    repoId: thread.repo?.id ?? thread.worktree.repoId ?? '',
    worktreeId: thread.worktree.id,
    tabId: thread.tab.id,
    leafId: parsePaneKey(thread.paneKey)?.leafId ?? null
  }
}

export function mergeBackgroundTasks(args: MergeBackgroundTasksArgs): BackgroundTaskItem[] {
  const {
    threads,
    workers,
    priorsByAgent,
    globalPrior,
    worktreeNameById,
    repoNameByWorktreeId,
    nowMs
  } = args

  const workerByPaneKey = new Map<string, BackgroundTaskWorkerRecord>()
  const workerByDispatchId = new Map<string, BackgroundTaskWorkerRecord>()
  for (const worker of workers) {
    workerByDispatchId.set(worker.dispatchId, worker)
    if (worker.paneKey && !workerByPaneKey.has(worker.paneKey)) {
      workerByPaneKey.set(worker.paneKey, worker)
    }
  }

  const matchedDispatchIds = new Set<string>()
  const items: BackgroundTaskItem[] = []

  for (const thread of threads) {
    const entry = thread.currentAgentEntry ?? thread.paneEntry
    const dispatchIdFromEntry = entry?.orchestration?.dispatchId ?? null
    const worker =
      (dispatchIdFromEntry ? workerByDispatchId.get(dispatchIdFromEntry) : undefined) ??
      workerByPaneKey.get(thread.paneKey) ??
      null
    if (worker) {
      matchedDispatchIds.add(worker.dispatchId)
    }

    const state = mapThreadToBackgroundState(thread)
    const agentType: AgentType | null =
      (thread.agentType && thread.agentType !== 'unknown' ? thread.agentType : null) ??
      resolveKnownAgentType(worker?.agent) ??
      null
    const normalizedAgent = normalizeEtaAgentKey(agentType)
    const startedAt =
      entry?.turnStartedAt ?? entry?.stateStartedAt ?? worker?.startedAt ?? thread.latestTimestamp
    const updatedAt = Math.max(
      entry?.updatedAt ?? 0,
      worker?.updatedAt ?? 0,
      thread.latestTimestamp
    )
    const completedAt =
      state === 'done' || state === 'failed'
        ? (entry?.turnEndedAt ?? worker?.completedAt ?? updatedAt)
        : null
    const { items: subagents, counts: subagentCounts } = extractBackgroundSubagents(entry)

    items.push({
      id: `pane:${thread.paneKey}`,
      paneKey: thread.paneKey,
      title:
        worker?.displayName?.trim() ||
        worker?.taskTitle?.trim() ||
        entry?.prompt?.trim() ||
        thread.paneTitle?.trim() ||
        worker?.objective?.trim() ||
        '',
      agentType,
      normalizedAgent,
      model: entry?.model ?? worker?.model ?? null,
      account: worker?.account ?? null,
      state,
      isActive: isActiveBackgroundTaskState(state),
      workspaceName: thread.worktree.displayName || thread.worktree.branch || null,
      repoName: thread.repo?.displayName ?? null,
      activityLine: buildBackgroundActivityLine(entry, worker),
      stage: worker?.stage ?? null,
      lastError: worker?.lastError ?? null,
      startedAt,
      updatedAt,
      completedAt,
      eta: estimateBackgroundTaskEta({
        state,
        agentType,
        startedAt,
        updatedAt,
        nowMs,
        stage: worker?.stage ?? null,
        stateHistory: entry?.stateHistory,
        subagentCounts,
        agentPrior: normalizedAgent ? (priorsByAgent[normalizedAgent] ?? null) : null,
        globalPrior,
        hasBackgroundWait: entry?.workingMode === 'monitoring'
      }),
      dispatchId: worker?.dispatchId ?? dispatchIdFromEntry,
      runId: worker?.runId ?? entry?.orchestration?.orchestrationRunId ?? null,
      messageCount: worker?.messageCount ?? 0,
      canStop: isStoppableBackgroundWorker(worker),
      subagents,
      revealTarget: resolveRevealTarget(thread)
    })
  }

  for (const worker of workers) {
    if (matchedDispatchIds.has(worker.dispatchId)) {
      continue
    }
    const state = mapWorkerToBackgroundState(worker)
    const agentType = resolveKnownAgentType(worker.agent)
    const normalizedAgent = normalizeEtaAgentKey(agentType)

    items.push({
      id: `dispatch:${worker.dispatchId}`,
      paneKey: worker.paneKey,
      title:
        worker.displayName?.trim() ||
        worker.taskTitle?.trim() ||
        worker.objective?.trim() ||
        worker.dispatchId,
      agentType,
      normalizedAgent,
      model: worker.model,
      account: worker.account,
      state,
      isActive: isActiveBackgroundTaskState(state),
      workspaceName: worker.worktreeId ? (worktreeNameById.get(worker.worktreeId) ?? null) : null,
      repoName: worker.worktreeId ? (repoNameByWorktreeId.get(worker.worktreeId) ?? null) : null,
      activityLine: buildBackgroundActivityLine(null, worker),
      stage: worker.stage,
      lastError: worker.lastError,
      startedAt: worker.startedAt,
      updatedAt: worker.updatedAt,
      completedAt: worker.completedAt,
      eta: estimateBackgroundTaskEta({
        state,
        agentType,
        startedAt: worker.startedAt,
        updatedAt: worker.updatedAt,
        nowMs,
        stage: worker.stage,
        agentPrior: normalizedAgent ? (priorsByAgent[normalizedAgent] ?? null) : null,
        globalPrior
      }),
      dispatchId: worker.dispatchId,
      runId: worker.runId,
      messageCount: worker.messageCount,
      canStop: isStoppableBackgroundWorker(worker),
      subagents: [],
      revealTarget: null
    })
  }

  items.sort((left, right) => {
    const rankDelta = STATE_SORT_RANK[left.state] - STATE_SORT_RANK[right.state]
    return rankDelta !== 0 ? rankDelta : right.updatedAt - left.updatedAt
  })

  return items
}
