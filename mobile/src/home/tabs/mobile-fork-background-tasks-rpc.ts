import * as z from 'zod'
import type {
  AgentDurationPrior,
  BackgroundTasksSnapshot,
  BackgroundTaskWorkerRecord
} from '../../../../src/shared/delegation/background-tasks-types'
import { defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'

// Fork: RPC operations and ETA estimation helpers for mobile background tasks (FORK.md §15).

const AgentDurationPriorSchema = z.object({
  agent: z.string(),
  sampleCount: z.number(),
  medianMs: z.number(),
  p75Ms: z.number()
})

const BackgroundTaskWorkerSchema = z.object({
  dispatchId: z.string(),
  runId: z.string(),
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  displayName: z.string().nullable(),
  objective: z.string().nullable(),
  agent: z.string().nullable(),
  model: z.string().nullable(),
  account: z.string().nullable(),
  state: z.string(),
  stage: z.string().nullable(),
  dispatchStatus: z.string(),
  paneKey: z.string().nullable(),
  worktreeId: z.string().nullable(),
  terminalHandle: z.string().nullable(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  messageCount: z.number()
})

const BackgroundTasksSnapshotSchema = z.object({
  workers: z.array(BackgroundTaskWorkerSchema),
  priorsByAgent: z.record(z.string(), AgentDurationPriorSchema),
  globalPrior: AgentDurationPriorSchema.nullable(),
  fetchedAt: z.number()
})

export const backgroundTasksReadOp = defineRpcOperation({
  name: 'fork.mobile-background-tasks-read',
  method: 'delegation.backgroundTasks',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('background-tasks', BackgroundTasksSnapshotSchema)
})

export const backgroundTaskStopOp = defineRpcOperation({
  name: 'fork.mobile-background-task-stop',
  method: 'orchestration.workerStop',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('worker-stop', z.unknown())
})

const ACTIVE_STATES = new Set([
  'pending',
  'dispatched',
  'starting',
  'ready',
  'start_unknown',
  'stopping'
])
const FAILED_STATES = new Set(['failed', 'abandoned', 'cancelled', 'stopped', 'stop_unknown'])

const AGENT_DEFAULTS_MS: Readonly<Record<string, number>> = {
  antigravity: 90_000,
  kiro: 150_000,
  'mistral-vibe': 150_000,
  opencode: 150_000,
  codex: 210_000,
  claude: 210_000
}

const AGENT_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  'mistral-vibe': 'Mistral Vibe',
  opencode: 'OpenCode'
}

const EARLY_STAGE_RE = /^(accepted|starting|launching|initializing|setup|provisioning)/i
const LATE_STAGE_RE = /^(verifying|settling|finishing|completing|reporting|wrapping)/i

export function normalizeWorkerAgentKey(agent: string | null | undefined): string {
  const lowered = agent?.trim().toLowerCase() ?? ''
  if (lowered === 'claude-agent-teams') {
    return 'claude'
  }
  if (lowered === 'opencode2') {
    return 'opencode'
  }
  return lowered
}

export function formatWorkerAgentLabel(agent: string | null | undefined): string {
  const key = normalizeWorkerAgentKey(agent)
  if (!key) {
    return 'Worker'
  }
  return AGENT_LABELS[key] ?? agent?.trim() ?? 'Worker'
}

export function isWorkerActive(worker: BackgroundTaskWorkerRecord): boolean {
  if (worker.completedAt !== null) {
    return false
  }
  return ACTIVE_STATES.has(worker.state) || ACTIVE_STATES.has(worker.dispatchStatus)
}

export function isWorkerFailed(worker: BackgroundTaskWorkerRecord): boolean {
  return (
    FAILED_STATES.has(worker.state) ||
    FAILED_STATES.has(worker.dispatchStatus) ||
    Boolean(worker.lastError)
  )
}

export function formatCompactDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s'
  }
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

export type WorkerEtaDisplay = {
  kind: 'countdown' | 'overrun' | 'stalled' | 'done' | 'failed'
  remainingMs: number | null
  progressRatio: number | null
}

export function estimateMobileWorkerEta(
  worker: BackgroundTaskWorkerRecord,
  snapshot: Pick<BackgroundTasksSnapshot, 'priorsByAgent' | 'globalPrior'>,
  nowMs: number
): WorkerEtaDisplay {
  if (!isWorkerActive(worker)) {
    return {
      kind: isWorkerFailed(worker) ? 'failed' : 'done',
      remainingMs: 0,
      progressRatio: 1
    }
  }
  if (nowMs - worker.updatedAt > 120_000) {
    return { kind: 'stalled', remainingMs: null, progressRatio: null }
  }
  const agentKey = normalizeWorkerAgentKey(worker.agent)
  const agentPrior: AgentDurationPrior | undefined = agentKey
    ? snapshot.priorsByAgent[agentKey]
    : undefined
  const expectedMs =
    agentPrior && agentPrior.sampleCount >= 2 && agentPrior.medianMs >= 5_000
      ? agentPrior.medianMs
      : snapshot.globalPrior &&
          snapshot.globalPrior.sampleCount >= 3 &&
          snapshot.globalPrior.medianMs >= 5_000
        ? snapshot.globalPrior.medianMs
        : (AGENT_DEFAULTS_MS[agentKey] ?? 180_000)
  const elapsedMs = Math.max(0, nowMs - worker.startedAt)
  if (elapsedMs > expectedMs * 1.15) {
    return { kind: 'overrun', remainingMs: null, progressRatio: 0.95 }
  }
  let rawRatio = expectedMs > 0 ? elapsedMs / expectedMs : 0
  let stageAdjusted = false
  if (worker.stage) {
    if (EARLY_STAGE_RE.test(worker.stage) && rawRatio > 0.15) {
      rawRatio = 0.15
      stageAdjusted = true
    } else if (LATE_STAGE_RE.test(worker.stage) && rawRatio < 0.8) {
      rawRatio = 0.8
      stageAdjusted = true
    }
  }
  const progressRatio = Math.min(0.95, Math.max(0.04, rawRatio))
  const rawRemaining = stageAdjusted
    ? Math.round(expectedMs * (1 - progressRatio))
    : Math.round(expectedMs - elapsedMs)
  return {
    kind: 'countdown',
    remainingMs: Math.max(5_000, rawRemaining),
    progressRatio
  }
}
