import type {
  AgentDurationPrior,
  BackgroundTaskShellRecord,
  BackgroundTaskWorkerRecord
} from '../../../../../shared/delegation/background-tasks-types'
import type {
  AgentStatusEntry,
  AgentType
} from '../../../../../shared/agent-status/contracts/agent-status-types'
import type { DashboardRevealAgentArgs } from '../../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { AgentPaneThread } from '@/components/activity/threads/activity-thread-types'
import type { BackgroundTaskEtaEstimate, BackgroundTaskEtaState } from './background-task-eta'

/** Fork: session-scoped background task view-model types and mappers (FORK.md §13). */

export type BackgroundTaskKind = 'shell' | 'subagent' | 'worker'
export type BackgroundTasksScope = 'session' | 'workspace' | 'all'

export type BackgroundTaskSubagentItem = {
  id: string
  label: string
  state: BackgroundTaskEtaState
  model?: string
}

export type BackgroundTaskItem = {
  id: string
  kind: BackgroundTaskKind
  paneKey: string | null
  ownerPaneKey: string | null
  worktreeId: string | null
  title: string
  agentType: AgentType | null
  normalizedAgent: string
  model: string | null
  account: string | null
  state: BackgroundTaskEtaState
  isActive: boolean
  workspaceName: string | null
  repoName: string | null
  activityLine: string | null
  outputTail: string | null
  progressLabel: string | null
  cpuPercent: number | null
  pid: number | null
  stage: string | null
  lastError: string | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
  eta: BackgroundTaskEtaEstimate
  dispatchId: string | null
  runId: string | null
  messageCount: number
  canStop: boolean
  subagents: BackgroundTaskSubagentItem[]
  revealTarget: DashboardRevealAgentArgs | null
}

export type MergeBackgroundTasksArgs = {
  shells: readonly BackgroundTaskShellRecord[]
  threads: readonly AgentPaneThread[]
  workers: readonly BackgroundTaskWorkerRecord[]
  priorsByAgent: Readonly<Record<string, AgentDurationPrior>>
  globalPrior: AgentDurationPrior | null
  worktreeNameById: ReadonlyMap<string, string>
  repoNameByWorktreeId: ReadonlyMap<string, string>
  nowMs: number
}

export const STATE_SORT_RANK: Readonly<Record<BackgroundTaskEtaState, number>> = {
  working: 0,
  blocked: 1,
  waiting: 2,
  failed: 3,
  done: 4
}

const ACTIVE_WORKER_STATES = new Set([
  'starting',
  'ready',
  'start_unknown',
  'stopping',
  'stop_unknown',
  'pending',
  'dispatched'
])

export function isActiveBackgroundTaskState(state: BackgroundTaskEtaState): boolean {
  return state === 'working' || state === 'blocked' || state === 'waiting'
}

export function isStoppableBackgroundWorker(worker: BackgroundTaskWorkerRecord | null): boolean {
  if (!worker) {
    return false
  }
  return (
    ACTIVE_WORKER_STATES.has(worker.state.toLowerCase()) ||
    worker.dispatchStatus === 'pending' ||
    worker.dispatchStatus === 'dispatched'
  )
}

export function mapWorkerToBackgroundState(
  worker: BackgroundTaskWorkerRecord
): BackgroundTaskEtaState {
  const state = worker.state.toLowerCase()
  const dispatch = worker.dispatchStatus.toLowerCase()
  if (state === 'failed' || dispatch === 'failed' || dispatch === 'circuit_broken') {
    return 'failed'
  }
  if (
    state === 'succeeded' ||
    state === 'stopped' ||
    state === 'abandoned' ||
    dispatch === 'completed'
  ) {
    return 'done'
  }
  return isStoppableBackgroundWorker(worker) ? 'working' : 'done'
}

export function mapShellToBackgroundState(
  shell: Pick<BackgroundTaskShellRecord, 'state'>
): BackgroundTaskEtaState {
  if (shell.state === 'failed') {
    return 'failed'
  }
  if (shell.state === 'done') {
    return 'done'
  }
  return 'working'
}

function mapChildState(state: string, outcome?: string): BackgroundTaskEtaState {
  if (state === 'done' || state === 'idle') {
    return outcome === 'failed' ? 'failed' : 'done'
  }
  if (state === 'blocked' || state === 'waiting') {
    return state
  }
  return 'working'
}

export function extractBackgroundSubagents(entry: AgentStatusEntry | null | undefined): {
  items: BackgroundTaskSubagentItem[]
  counts: { done: number; total: number } | null
} {
  if (!entry) {
    return { items: [], counts: null }
  }
  const items: BackgroundTaskSubagentItem[] =
    entry.children && entry.children.length > 0
      ? entry.children.map((child) => ({
          id: child.id,
          label: child.name ?? child.description ?? child.agentType ?? child.kind,
          state: mapChildState(child.state, child.outcome),
          ...(child.model ? { model: child.model } : {})
        }))
      : entry.subagents && entry.subagents.length > 0
        ? entry.subagents.map((sub) => ({
            id: sub.id,
            label: sub.description ?? sub.agentType ?? sub.id,
            state: mapChildState(sub.state),
            ...(sub.model ? { model: sub.model } : {})
          }))
        : []
  if (items.length === 0) {
    return { items, counts: null }
  }
  const done = items.filter((item) => item.state === 'done' || item.state === 'failed').length
  return { items, counts: { done, total: items.length } }
}

export function summarizeShellCommandTitle(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) {
    return 'Background shell'
  }
  if (/\borca\s+orchestration\s+check\b/i.test(trimmed)) {
    return 'Waiting for delegated worker'
  }
  if (/\b(autoninja|ninja)\b/i.test(trimmed)) {
    return 'Native build (ninja)'
  }
  if (/\bbuild-macos|out\/Release\b/i.test(trimmed)) {
    return 'Release build'
  }
  if (/\bgradlew\s+assemble/i.test(trimmed)) {
    return 'Android Gradle build'
  }
  if (/\b(vitest|jest|pytest|playwright|cargo\s+test|go\s+test|gradlew\s+test)\b/i.test(trimmed)) {
    return 'Background test run'
  }
  if (/\b(ffmpeg|blender|remotion)\b/i.test(trimmed)) {
    return 'Background media render'
  }
  // Strip leading `cd ... &&` or `export ... &&` boilerplate so the actual command leads.
  const core =
    trimmed
      .split(/\s*(?:&&|;)\s*/)
      .map((seg) => seg.trim())
      .find((seg) => seg.length > 0 && !/^(?:cd|export|set)\s+/i.test(seg)) ?? trimmed
  return core.length > 72 ? `${core.slice(0, 69)}…` : core
}

export function buildBackgroundActivityLine(
  entry: AgentStatusEntry | null | undefined,
  worker: BackgroundTaskWorkerRecord | null
): string | null {
  if (worker?.lastError) {
    return worker.lastError
  }
  if (entry?.toolName) {
    return entry.toolInput ? `${entry.toolName}: ${entry.toolInput}` : entry.toolName
  }
  if (worker?.stage && isStoppableBackgroundWorker(worker)) {
    return worker.stage
  }
  return null
}
