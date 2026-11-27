import type { AgentDurationPrior } from '../../../../../shared/delegation/background-tasks-types'
import type { AgentStateHistoryEntry } from '../../../../../shared/agent-status/lifecycle/agent-state-history'
import {
  defaultAgentDurationMs,
  formatDurationCompact,
  inferShellCommandPriorMs,
  normalizeEtaAgentKey
} from './background-task-eta-priors'

export {
  defaultAgentDurationMs,
  formatDurationCompact,
  inferShellCommandPriorMs,
  normalizeEtaAgentKey
}

/** Fork: pure completion-ETA estimation for session shells, subagents, and workers (FORK.md §13). */

export type BackgroundTaskEtaState = 'working' | 'blocked' | 'waiting' | 'done' | 'failed'
export type BackgroundTaskEtaKind =
  | 'countdown'
  | 'overrun'
  | 'waiting'
  | 'stalled'
  | 'done'
  | 'unknown'
export type BackgroundTaskEtaBasis =
  | 'steps'
  | 'command'
  | 'subagents'
  | 'history'
  | 'prior'
  | 'default'

export type BackgroundTaskEtaEstimate = {
  kind: BackgroundTaskEtaKind
  remainingMs: number | null
  progressRatio: number | null
  expectedTotalMs: number | null
  basis: BackgroundTaskEtaBasis
}

export type BackgroundTaskEtaInput = {
  state: BackgroundTaskEtaState
  agentType: string | null | undefined
  startedAt: number
  updatedAt: number
  nowMs: number
  stage?: string | null
  stateHistory?: readonly AgentStateHistoryEntry[]
  subagentCounts?: { done: number; total: number } | null
  stepProgress?: {
    completedSteps: number | null
    totalSteps: number | null
    percent: number
  } | null
  commandHint?: string | null
  agentPrior?: AgentDurationPrior | null
  globalPrior?: AgentDurationPrior | null
  hasBackgroundWait?: boolean
}

export const STALLED_HEARTBEAT_THRESHOLD_MS = 120_000
export const MIN_COUNTDOWN_REMAINING_MS = 5_000
export const OVERRUN_MULTIPLIER = 1.15
const MIN_DURATION_MS = 5_000
const MAX_DURATION_MS = 4 * 60 * 60 * 1000
const MIN_SUBAGENT_PACING_ELAPSED_MS = 5_000

const EARLY_STAGE_RE = /^(accepted|starting|launching|initializing|setup|provisioning)/i
const LATE_STAGE_RE = /^(verifying|settling|finishing|completing|reporting|wrapping)/i

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function extractCompletedWorkingDurationsMs(
  history: readonly AgentStateHistoryEntry[] | undefined,
  currentStartedAt: number
): number[] {
  if (!history || history.length === 0) {
    return []
  }
  const durations: number[] = []
  for (let i = 0; i < history.length; i++) {
    const entry = history[i]
    if (entry.state !== 'working') {
      continue
    }
    const next = history[i + 1]
    const endMs = next ? (next.observedAt ?? next.startedAt) : currentStartedAt
    const startMs = entry.startedAt
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const duration = endMs - startMs
      if (duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS) {
        durations.push(duration)
      }
    }
  }
  return durations
}

export function estimateBackgroundTaskEta(
  input: BackgroundTaskEtaInput
): BackgroundTaskEtaEstimate {
  if (input.state === 'done' || input.state === 'failed') {
    return {
      kind: 'done',
      remainingMs: 0,
      progressRatio: 1,
      expectedTotalMs: null,
      basis: 'default'
    }
  }
  if (input.state === 'blocked' || input.state === 'waiting') {
    return {
      kind: 'waiting',
      remainingMs: null,
      progressRatio: null,
      expectedTotalMs: null,
      basis: 'default'
    }
  }
  if (!Number.isFinite(input.startedAt) || input.startedAt <= 0 || !Number.isFinite(input.nowMs)) {
    return {
      kind: 'unknown',
      remainingMs: null,
      progressRatio: null,
      expectedTotalMs: null,
      basis: 'default'
    }
  }

  const elapsedMs = Math.max(0, input.nowMs - input.startedAt)
  if (
    input.stepProgress &&
    Number.isFinite(input.stepProgress.percent) &&
    input.stepProgress.percent > 0 &&
    input.stepProgress.percent < 100
  ) {
    const progressRatio = clamp(input.stepProgress.percent / 100, 0.02, 0.99)
    if (input.stepProgress.percent >= 2 && elapsedMs >= MIN_DURATION_MS) {
      const pacedRemaining = Math.round((elapsedMs * (1 - progressRatio)) / progressRatio)
      const remainingMs = clamp(pacedRemaining, MIN_COUNTDOWN_REMAINING_MS, MAX_DURATION_MS)
      return {
        kind: 'countdown',
        remainingMs,
        progressRatio,
        expectedTotalMs: elapsedMs + remainingMs,
        basis: 'steps'
      }
    }
  }

  if (
    !input.hasBackgroundWait &&
    Number.isFinite(input.updatedAt) &&
    input.updatedAt > 0 &&
    input.nowMs - input.updatedAt > STALLED_HEARTBEAT_THRESHOLD_MS
  ) {
    return {
      kind: 'stalled',
      remainingMs: null,
      progressRatio: null,
      expectedTotalMs: null,
      basis: 'default'
    }
  }

  let expectedTotalMs = defaultAgentDurationMs(input.agentType)
  let basis: BackgroundTaskEtaBasis = 'default'
  const commandPriorMs = inferShellCommandPriorMs(input.commandHint)
  if (commandPriorMs !== null) {
    expectedTotalMs = commandPriorMs
    basis = 'command'
  } else if (
    input.agentPrior &&
    input.agentPrior.sampleCount >= 2 &&
    Number.isFinite(input.agentPrior.medianMs) &&
    input.agentPrior.medianMs >= MIN_DURATION_MS
  ) {
    expectedTotalMs = clamp(input.agentPrior.medianMs, MIN_DURATION_MS, MAX_DURATION_MS)
    basis = 'prior'
  } else if (
    input.globalPrior &&
    input.globalPrior.sampleCount >= 3 &&
    Number.isFinite(input.globalPrior.medianMs) &&
    input.globalPrior.medianMs >= MIN_DURATION_MS
  ) {
    expectedTotalMs = clamp(input.globalPrior.medianMs, MIN_DURATION_MS, MAX_DURATION_MS)
    basis = 'prior'
  }

  const historyMedianMs = medianOf(
    extractCompletedWorkingDurationsMs(input.stateHistory, input.startedAt)
  )
  if (historyMedianMs !== null && basis !== 'command') {
    expectedTotalMs = clamp(
      Math.round(historyMedianMs * 0.6 + expectedTotalMs * 0.4),
      MIN_DURATION_MS,
      MAX_DURATION_MS
    )
    basis = 'history'
  }

  const subagents = input.subagentCounts
  if (
    subagents &&
    subagents.total >= 2 &&
    subagents.done > 0 &&
    subagents.done < subagents.total &&
    elapsedMs >= MIN_SUBAGENT_PACING_ELAPSED_MS
  ) {
    const pacedTotal = elapsedMs / (subagents.done / subagents.total)
    expectedTotalMs = clamp(
      Math.round(pacedTotal * 0.6 + expectedTotalMs * 0.4),
      MIN_DURATION_MS,
      MAX_DURATION_MS
    )
    basis = 'subagents'
  }

  if (elapsedMs > expectedTotalMs * OVERRUN_MULTIPLIER) {
    return { kind: 'overrun', remainingMs: null, progressRatio: 0.95, expectedTotalMs, basis }
  }

  let rawRatio = expectedTotalMs > 0 ? elapsedMs / expectedTotalMs : 0
  let stageAdjusted = false
  if (input.stage) {
    if (EARLY_STAGE_RE.test(input.stage) && rawRatio > 0.15) {
      rawRatio = 0.15
      stageAdjusted = true
    } else if (LATE_STAGE_RE.test(input.stage) && rawRatio < 0.8) {
      rawRatio = 0.8
      stageAdjusted = true
    }
  }

  const progressRatio = clamp(rawRatio, 0.04, 0.95)
  const rawRemainingMs = stageAdjusted
    ? Math.round(expectedTotalMs * (1 - progressRatio))
    : Math.round(expectedTotalMs - elapsedMs)
  return {
    kind: 'countdown',
    remainingMs: Math.max(MIN_COUNTDOWN_REMAINING_MS, rawRemainingMs),
    progressRatio,
    expectedTotalMs,
    basis
  }
}
