import { describe, expect, it } from 'vitest'
import {
  defaultAgentDurationMs,
  estimateBackgroundTaskEta,
  formatDurationCompact,
  MIN_COUNTDOWN_REMAINING_MS,
  STALLED_HEARTBEAT_THRESHOLD_MS
} from './background-task-eta'

describe('background-task ETA estimation', () => {
  const baseNow = 1_700_000_000_000

  it('returns terminal done state for done and failed tasks', () => {
    const done = estimateBackgroundTaskEta({
      state: 'done',
      agentType: 'claude',
      startedAt: baseNow - 30_000,
      updatedAt: baseNow,
      nowMs: baseNow
    })
    const failed = estimateBackgroundTaskEta({
      state: 'failed',
      agentType: 'codex',
      startedAt: baseNow - 30_000,
      updatedAt: baseNow,
      nowMs: baseNow
    })
    expect(done).toMatchObject({ kind: 'done', remainingMs: 0, progressRatio: 1 })
    expect(failed).toMatchObject({ kind: 'done', remainingMs: 0, progressRatio: 1 })
  })

  it('returns waiting state for blocked and waiting tasks without a countdown', () => {
    for (const state of ['blocked', 'waiting'] as const) {
      const result = estimateBackgroundTaskEta({
        state,
        agentType: 'kiro',
        startedAt: baseNow - 45_000,
        updatedAt: baseNow - 1_000,
        nowMs: baseNow
      })
      expect(result).toMatchObject({
        kind: 'waiting',
        remainingMs: null,
        progressRatio: null
      })
    }
  })

  it('detects stalled heartbeats after threshold unless monitoring background wait', () => {
    const stalled = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'claude',
      startedAt: baseNow - 180_000,
      updatedAt: baseNow - (STALLED_HEARTBEAT_THRESHOLD_MS + 1_000),
      nowMs: baseNow
    })
    expect(stalled.kind).toBe('stalled')
    expect(stalled.remainingMs).toBeNull()

    const monitoring = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'claude',
      startedAt: baseNow - 180_000,
      updatedAt: baseNow - (STALLED_HEARTBEAT_THRESHOLD_MS + 10_000),
      nowMs: baseNow,
      hasBackgroundWait: true
    })
    expect(monitoring.kind).toBe('countdown')
  })

  it('uses distinct conservative default priors across all 6 delegation agents', () => {
    expect(defaultAgentDurationMs('antigravity')).toBe(90_000)
    expect(defaultAgentDurationMs('kiro')).toBe(150_000)
    expect(defaultAgentDurationMs('mistral-vibe')).toBe(150_000)
    expect(defaultAgentDurationMs('opencode')).toBe(150_000)
    expect(defaultAgentDurationMs('codex')).toBe(210_000)
    expect(defaultAgentDurationMs('claude')).toBe(210_000)
    expect(defaultAgentDurationMs('some-custom-agent')).toBe(180_000)
  })

  it('never reports a negative or sub-5s countdown and transitions to overrun past 1.15x', () => {
    // Antigravity default is 90s; at 89s elapsed, remaining clamps to >= 5s.
    const nearEnd = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 89_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow
    })
    expect(nearEnd.kind).toBe('countdown')
    expect(nearEnd.remainingMs).toBe(MIN_COUNTDOWN_REMAINING_MS)
    expect(nearEnd.progressRatio).toBeLessThanOrEqual(0.95)

    // At 100s (within 1.15 * 90s = 103.5s), still countdown clamped to 5s.
    const graceWindow = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 100_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow
    })
    expect(graceWindow.kind).toBe('countdown')
    expect(graceWindow.remainingMs).toBe(MIN_COUNTDOWN_REMAINING_MS)

    // Past 1.15 * 90s = 103.5s -> overrun with null remainingMs and 0.95 bar.
    const overrun = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 110_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow
    })
    expect(overrun).toMatchObject({
      kind: 'overrun',
      remainingMs: null,
      progressRatio: 0.95,
      basis: 'default'
    })
  })

  it('weights empirical agent priors (>=2 samples) and global priors (>=3 samples)', () => {
    const withAgentPrior = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'claude',
      startedAt: baseNow - 20_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      agentPrior: { agent: 'claude', sampleCount: 4, medianMs: 60_000, p75Ms: 80_000 }
    })
    expect(withAgentPrior).toMatchObject({
      kind: 'countdown',
      expectedTotalMs: 60_000,
      remainingMs: 40_000,
      basis: 'prior'
    })

    // Single-sample agent prior is ignored; falls back to 3-sample global prior.
    const withGlobalPrior = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'mistral-vibe',
      startedAt: baseNow - 20_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      agentPrior: { agent: 'mistral-vibe', sampleCount: 1, medianMs: 30_000, p75Ms: 30_000 },
      globalPrior: { agent: 'all', sampleCount: 5, medianMs: 100_000, p75Ms: 120_000 }
    })
    expect(withGlobalPrior).toMatchObject({
      kind: 'countdown',
      expectedTotalMs: 100_000,
      remainingMs: 80_000,
      basis: 'prior'
    })
  })

  it('blends completed working-turn stateHistory with base prior', () => {
    // Base antigravity default = 90s; one 30s completed working turn -> 0.6 * 30s + 0.4 * 90s = 54s.
    const result = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 14_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      stateHistory: [
        { state: 'working', prompt: 'step 1', startedAt: baseNow - 80_000 },
        { state: 'done', prompt: 'step 1', startedAt: baseNow - 50_000 }
      ]
    })
    expect(result).toMatchObject({
      kind: 'countdown',
      expectedTotalMs: 54_000,
      remainingMs: 40_000,
      basis: 'history'
    })
  })

  it('uses subagent completion-ratio pacing blended 60/40 with prior', () => {
    // 2 of 4 subagents done in 40s -> paced total = 80s; prior (antigravity default) = 90s.
    // Blended = 0.6 * 80s + 0.4 * 90s = 84s -> remaining = 44s.
    const result = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 40_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      subagentCounts: { done: 2, total: 4 }
    })
    expect(result).toMatchObject({
      kind: 'countdown',
      expectedTotalMs: 84_000,
      remainingMs: 44_000,
      basis: 'subagents'
    })
  })

  it('applies orchestration stage bounds for launching and verifying stages', () => {
    const launching = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'antigravity',
      startedAt: baseNow - 30_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      stage: 'launching'
    })
    expect(launching.kind).toBe('countdown')
    expect(launching.progressRatio).toBe(0.15)

    const verifying = estimateBackgroundTaskEta({
      state: 'working',
      agentType: 'claude',
      startedAt: baseNow - 10_000,
      updatedAt: baseNow - 1_000,
      nowMs: baseNow,
      stage: 'verifying'
    })
    expect(verifying.kind).toBe('countdown')
    expect(verifying.progressRatio).toBe(0.8)
  })

  it('formats durations compactly across seconds, minutes, and hours', () => {
    expect(formatDurationCompact(0)).toBe('0s')
    expect(formatDurationCompact(-5000)).toBe('0s')
    expect(formatDurationCompact(45_000)).toBe('45s')
    expect(formatDurationCompact(135_000)).toBe('2m 15s')
    expect(formatDurationCompact(120_000)).toBe('2m')
    expect(formatDurationCompact(4_200_000)).toBe('1h 10m')
    expect(formatDurationCompact(3_600_000)).toBe('1h')
  })
})
