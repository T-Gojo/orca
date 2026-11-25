import type { AgentDurationPrior } from '../../../../../shared/delegation/background-tasks-types'
import type { AgentStateHistoryEntry } from '../../../../../shared/agent-status/lifecycle/agent-state-history'

/** Fork: pure completion-ETA estimation heuristics for background tasks (FORK.md §13). */

export type BackgroundTaskEtaState = 'working' | 'blocked' | 'waiting' | 'done' | 'failed'

export type BackgroundTaskEtaKind =
  | 'countdown'
  | 'overrun'
  | 'waiting'
  | 'stalled'
  | 'done'
  | 'unknown'

export type BackgroundTaskEtaBasis = 'subagents' | 'history' | 'prior' | 'default'

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
  agentPrior?: AgentDurationPrior | null
  globalPrior?: AgentDurationPrior | null
  /** True when the agent is explicitly monitoring/waiting on a background command. */
  hasBackgroundWait?: boolean
}

export const STALLED_HEARTBEAT_THRESHOLD_MS = 120_000
export const MIN_COUNTDOWN_REMAINING_MS = 5_000
export const OVERRUN_MULTIPLIER = 1.15
const MIN_DURATION_MS = 5_000
const MAX_DURATION_MS = 4 * 60 * 60 * 1000
const MIN_SUBAGENT_PACING_ELAPSED_MS = 5_000
const DEFAULT_FALLBACK_DURATION_MS = 180_000

const AGENT_DEFAULT_DURATION_MS: Readonly<Record<string, number>> = {
  antigravity: 90_000,
  kiro: 150_000,
  'mistral-vibe': 150_000,
  opencode: 150_000,
  opencode2: 150_000,
  codex: 210_000,
  claude: 210_000,
  'claude-agent-teams': 210_000
}

const EARLY_STAGE_RE = /^(accepted|starting|launching|initializing|setup|provisioning)/i
const LATE_STAGE_RE = /^(verifying|settling|finishing|completing|reporting|wrapping)/i

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeEtaAgentKey(agentType: string | null | undefined): string {
  const normalized = agentType?.trim().toLowerCase() ?? ''
  if (normalized === 'claude-agent-teams') {
    return 'claude'
  }
  if (normalized === 'opencode2') {
    return 'opencode'
  }
  return normalized
}

export function defaultAgentDurationMs(agentType: string | null | undefined): number {
  const key = normalizeEtaAgentKey(agentType)
  return AGENT_DEFAULT_DURATION_MS[key] ?? DEFAULT_FALLBACK_DURATION_MS
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid]
  }
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/** Extract completed working-turn durations from stateHistory (each working entry until the next transition). */
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
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue
    }
    const duration = endMs - startMs
    if (duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS) {
      durations.push(duration)
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

  // Build empirical prior: agent DB prior (>=2 samples) > global DB prior (>=3 samples) > conservative default.
  let expectedTotalMs = defaultAgentDurationMs(input.agentType)
  let basis: BackgroundTaskEtaBasis = 'default'

  if (
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

  // Blend completed working-turn durations on this same pane when available.
  const historyDurations = extractCompletedWorkingDurationsMs(input.stateHistory, input.startedAt)
  const historyMedianMs = medianOf(historyDurations)
  if (historyMedianMs !== null) {
    expectedTotalMs = clamp(
      Math.round(historyMedianMs * 0.6 + expectedTotalMs * 0.4),
      MIN_DURATION_MS,
      MAX_DURATION_MS
    )
    basis = 'history'
  }

  // Subagent completion-ratio pacing when at least 2 subagents exist and partial progress is known.
  const subagents = input.subagentCounts
  if (
    subagents &&
    subagents.total >= 2 &&
    subagents.done > 0 &&
    subagents.done < subagents.total &&
    elapsedMs >= MIN_SUBAGENT_PACING_ELAPSED_MS
  ) {
    const completionFraction = subagents.done / subagents.total
    const pacedTotal = elapsedMs / completionFraction
    expectedTotalMs = clamp(
      Math.round(pacedTotal * 0.6 + expectedTotalMs * 0.4),
      MIN_DURATION_MS,
      MAX_DURATION_MS
    )
    basis = 'subagents'
  }

  // Check overrun before stage adjustments so long-running tasks never stick at "5s left".
  if (elapsedMs > expectedTotalMs * OVERRUN_MULTIPLIER) {
    return {
      kind: 'overrun',
      remainingMs: null,
      progressRatio: 0.95,
      expectedTotalMs,
      basis
    }
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
  const remainingMs = Math.max(MIN_COUNTDOWN_REMAINING_MS, rawRemainingMs)

  return {
    kind: 'countdown',
    remainingMs,
    progressRatio,
    expectedTotalMs,
    basis
  }
}

export function formatDurationCompact(ms: number): string {
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
