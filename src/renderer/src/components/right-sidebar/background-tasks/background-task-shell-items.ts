import type {
  AgentDurationPrior,
  BackgroundTaskShellRecord
} from '../../../../../shared/delegation/background-tasks-types'
import type { AgentType } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { DashboardRevealAgentArgs } from '../../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { AgentPaneThread } from '@/components/activity/threads/activity-thread-types'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { estimateBackgroundTaskEta, normalizeEtaAgentKey } from './background-task-eta'
import {
  extractBackgroundSubagents,
  isActiveBackgroundTaskState,
  mapShellToBackgroundState,
  summarizeShellCommandTitle,
  type BackgroundTaskItem
} from './background-task-item'

/** Fork: projects live background shells and in-session subagents into BackgroundTaskItem cards (FORK.md §13). */

const ORCHESTRATION_WAIT_SHELL_RE = /\borca\s+orchestration\s+check\b.*--wait/i

export function resolveKnownAgentType(agent: string | null | undefined): AgentType | null {
  if (!agent) {
    return null
  }
  if (agent === 'dsb' || agent === 'unknown') {
    return agent
  }
  return getAgentCatalog().find((entry) => entry.id === agent)?.id ?? null
}

export function resolveRevealTarget(
  thread: AgentPaneThread | undefined
): DashboardRevealAgentArgs | null {
  if (!thread?.worktree.id || !thread.tab.id) {
    return null
  }
  return {
    repoId: thread.repo?.id ?? thread.worktree.repoId ?? '',
    worktreeId: thread.worktree.id,
    tabId: thread.tab.id,
    leafId: parsePaneKey(thread.paneKey)?.leafId ?? null
  }
}

export function buildShellAndSubagentItems(args: {
  shells: readonly BackgroundTaskShellRecord[]
  threads: readonly AgentPaneThread[]
  threadByPaneKey: ReadonlyMap<string, AgentPaneThread>
  workerPaneKeys: ReadonlySet<string>
  activeWorkerOwnerPanes: ReadonlySet<string>
  priorsByAgent: Readonly<Record<string, AgentDurationPrior>>
  globalPrior: AgentDurationPrior | null
  worktreeNameById: ReadonlyMap<string, string>
  repoNameByWorktreeId: ReadonlyMap<string, string>
  nowMs: number
}): BackgroundTaskItem[] {
  const {
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
  } = args

  const coveredRunningShellPanes = new Set<string>()
  const items: BackgroundTaskItem[] = []

  for (const shell of shells) {
    if (shell.state === 'running') {
      coveredRunningShellPanes.add(shell.paneKey)
      if (
        ORCHESTRATION_WAIT_SHELL_RE.test(shell.command) &&
        activeWorkerOwnerPanes.has(shell.paneKey)
      ) {
        continue
      }
    }
    const ownerThread = threadByPaneKey.get(shell.paneKey)
    const ownerEntry = ownerThread?.currentAgentEntry ?? ownerThread?.paneEntry
    const state = mapShellToBackgroundState(shell)
    const agentType =
      (ownerThread?.agentType && ownerThread.agentType !== 'unknown'
        ? ownerThread.agentType
        : null) ?? resolveKnownAgentType(shell.agent)
    const normalizedAgent = normalizeEtaAgentKey(agentType)
    const worktreeId = shell.worktreeId ?? ownerThread?.worktree.id ?? null

    items.push({
      id: shell.id,
      kind: 'shell',
      paneKey: shell.paneKey,
      ownerPaneKey: shell.paneKey,
      worktreeId,
      title: summarizeShellCommandTitle(shell.command),
      agentType,
      normalizedAgent,
      model: ownerEntry?.model ?? null,
      account: null,
      state,
      isActive: isActiveBackgroundTaskState(state),
      workspaceName:
        ownerThread?.worktree.displayName ||
        ownerThread?.worktree.branch ||
        (worktreeId ? (worktreeNameById.get(worktreeId) ?? null) : null),
      repoName:
        ownerThread?.repo?.displayName ??
        (worktreeId ? (repoNameByWorktreeId.get(worktreeId) ?? null) : null),
      activityLine: shell.command,
      outputTail: shell.outputTail,
      progressLabel: shell.progress?.label ?? null,
      cpuPercent: shell.cpuPercent,
      pid: shell.pid,
      stage: null,
      lastError:
        shell.state === 'failed' && shell.exitCode !== null ? `Exited (${shell.exitCode})` : null,
      startedAt: shell.startedAt,
      updatedAt: shell.updatedAt,
      completedAt: shell.completedAt,
      eta: estimateBackgroundTaskEta({
        state,
        agentType,
        startedAt: shell.startedAt,
        updatedAt: shell.updatedAt,
        nowMs,
        stepProgress: shell.progress,
        commandHint: shell.command,
        hasBackgroundWait: true
      }),
      dispatchId: null,
      runId: ownerEntry?.orchestration?.orchestrationRunId ?? null,
      messageCount: 0,
      canStop: false,
      subagents: [],
      revealTarget: resolveRevealTarget(ownerThread)
    })
  }

  for (const thread of threads) {
    const entry = thread.currentAgentEntry ?? thread.paneEntry
    if (!entry) {
      continue
    }
    const agentType = thread.agentType !== 'unknown' ? thread.agentType : null
    const normalizedAgent = normalizeEtaAgentKey(agentType)

    if (
      !coveredRunningShellPanes.has(thread.paneKey) &&
      entry.workingMode === 'monitoring' &&
      !activeWorkerOwnerPanes.has(thread.paneKey)
    ) {
      const startedAt =
        entry.mainAgent?.stateStartedAt ?? entry.stateStartedAt ?? thread.latestTimestamp
      const cmd = entry.toolInput
        ? `${entry.toolName ?? 'Bash'}: ${entry.toolInput}`
        : 'Background shell'
      items.push({
        id: `hook-shell:${thread.paneKey}`,
        kind: 'shell',
        paneKey: thread.paneKey,
        ownerPaneKey: thread.paneKey,
        worktreeId: thread.worktree.id,
        title: summarizeShellCommandTitle(cmd),
        agentType,
        normalizedAgent,
        model: entry.model ?? null,
        account: null,
        state: 'working',
        isActive: true,
        workspaceName: thread.worktree.displayName || thread.worktree.branch || null,
        repoName: thread.repo?.displayName ?? null,
        activityLine: cmd,
        outputTail: null,
        progressLabel: null,
        cpuPercent: null,
        pid: null,
        stage: null,
        lastError: null,
        startedAt,
        updatedAt: entry.updatedAt ?? nowMs,
        completedAt: null,
        eta: estimateBackgroundTaskEta({
          state: 'working',
          agentType,
          startedAt,
          updatedAt: entry.updatedAt ?? nowMs,
          nowMs,
          commandHint: cmd,
          hasBackgroundWait: true
        }),
        dispatchId: null,
        runId: entry.orchestration?.orchestrationRunId ?? null,
        messageCount: 0,
        canStop: false,
        subagents: [],
        revealTarget: resolveRevealTarget(thread)
      })
    }

    if (!workerPaneKeys.has(thread.paneKey)) {
      for (const sub of extractBackgroundSubagents(entry).items) {
        const isActive = isActiveBackgroundTaskState(sub.state)
        const startedAt = entry.turnStartedAt ?? entry.stateStartedAt ?? thread.latestTimestamp
        items.push({
          id: `subagent:${thread.paneKey}:${sub.id}`,
          kind: 'subagent',
          paneKey: thread.paneKey,
          ownerPaneKey: thread.paneKey,
          worktreeId: thread.worktree.id,
          title: sub.label,
          agentType,
          normalizedAgent,
          model: sub.model ?? entry.model ?? null,
          account: null,
          state: sub.state,
          isActive,
          workspaceName: thread.worktree.displayName || thread.worktree.branch || null,
          repoName: thread.repo?.displayName ?? null,
          activityLine: null,
          outputTail: null,
          progressLabel: null,
          cpuPercent: null,
          pid: null,
          stage: null,
          lastError: null,
          startedAt,
          updatedAt: entry.updatedAt ?? nowMs,
          completedAt: isActive ? null : (entry.updatedAt ?? nowMs),
          eta: estimateBackgroundTaskEta({
            state: sub.state,
            agentType,
            startedAt,
            updatedAt: entry.updatedAt ?? nowMs,
            nowMs,
            agentPrior: normalizedAgent ? (priorsByAgent[normalizedAgent] ?? null) : null,
            globalPrior,
            hasBackgroundWait: true
          }),
          dispatchId: null,
          runId: entry.orchestration?.orchestrationRunId ?? null,
          messageCount: 0,
          canStop: false,
          subagents: [],
          revealTarget: resolveRevealTarget(thread)
        })
      }
    }
  }

  return items
}
