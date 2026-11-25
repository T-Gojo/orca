import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import type { AccountUsageHourlyBucket } from '../../shared/account-usage-windows-types'
import { collectMistralVibeUsage } from '../mistral/vibe-session-usage'
import { openCodeAggregateBucket } from './account-usage-buckets'
import { removeAccountUsageEntry, toUtcHourKey } from './account-usage-hourly-model'
import { summarizeAccountUsageWindows } from './account-usage-windows-summary'
import {
  emptyAccountUsageLedger,
  recordSourceRollups,
  type AccountUsageLedgerState,
  type ResolvedSourceAccount
} from './account-usage-ledger-model'

const NOW_MS = Date.UTC(2026, 10, 25, 21, 30, 0) // 2026-11-25T21:30:00Z
const TWO_HOURS_AGO_MS = Date.UTC(2026, 10, 25, 19, 15, 0) // 2026-11-25T19:15:00Z
const SIX_HOURS_AGO_MS = Date.UTC(2026, 10, 25, 15, 10, 0) // 2026-11-25T15:10:00Z

function dayBucket(
  day: string,
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheTokens = 0
): AccountUsageBucket {
  return {
    day,
    model,
    inputTokens,
    outputTokens,
    cacheTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + outputTokens + cacheTokens,
    activity: 1,
    credits: 0,
    costUsd: null
  }
}

function hourlyBucket(
  hour: string,
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheTokens = 0
): AccountUsageHourlyBucket {
  return {
    hour,
    model,
    inputTokens,
    outputTokens,
    cacheTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + outputTokens + cacheTokens,
    activity: 1,
    credits: 0,
    costUsd: null
  }
}

const certain =
  (accountKey: string, label: string | null = `${accountKey}@example.com`) =>
  (): ResolvedSourceAccount => ({ accountKey, label, certain: true })

const allSaved = (): boolean => true

describe('account usage windows ledger', () => {
  it('accumulates exact hourly deltas and stamps non-baseline day-only deltas to current UTC hour without spiking 1h on baseline', () => {
    // 1) Day-only scanner (Claude): baseline must NOT spike 1h, subsequent growth MUST land in current UTC hour.
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [
        {
          source: 'claude-sess-1',
          home: null,
          session: 'claude-sess-1',
          buckets: [dayBucket('2026-11-25', 'claude-opus-4-5', 500, 200, 100)]
        }
      ],
      certain('claude-a'),
      NOW_MS
    )

    const afterBaseline = summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS)
    expect(afterBaseline.rows).toEqual([])
    expect(afterBaseline.summaries.find((entry) => entry.window === '1h')?.totalTokens).toBe(0)
    expect(afterBaseline.summaries.find((entry) => entry.window === 'all')?.totalTokens).toBe(800)

    // Subsequent growth on the same day-only source lands in NOW_MS's UTC hour.
    state = recordSourceRollups(
      state,
      'claude',
      [
        {
          source: 'claude-sess-1',
          home: null,
          session: 'claude-sess-1',
          buckets: [dayBucket('2026-11-25', 'claude-opus-4-5', 650, 250, 150)]
        }
      ],
      certain('claude-a'),
      NOW_MS
    )

    // 2) Timestamped scanner (Mistral): exact hourlyBuckets populate each hour directly, even on baseline.
    const mistralRollup: UsageSourceRollup = {
      source: 'vibe-sess-1',
      home: null,
      session: 'org+user',
      buckets: [dayBucket('2026-11-25', 'devstral-2', 300, 150, 60)],
      hourlyBuckets: [
        hourlyBucket(toUtcHourKey(SIX_HOURS_AGO_MS)!, 'devstral-2', 100, 50, 20),
        hourlyBucket(toUtcHourKey(TWO_HOURS_AGO_MS)!, 'devstral-2', 120, 60, 20),
        hourlyBucket(toUtcHourKey(NOW_MS)!, 'devstral-2', 80, 40, 20)
      ]
    }
    state = recordSourceRollups(state, 'mistral', [mistralRollup], certain('mistral-a'), NOW_MS)

    const oneHour = summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS)
    expect(oneHour.summaries.find((entry) => entry.window === '1h')).toMatchObject({
      inputTokens: 150 + 80,
      outputTokens: 50 + 40,
      cacheTokens: 50 + 20,
      totalTokens: 250 + 140
    })
    expect(oneHour.summaries.find((entry) => entry.window === '5h')).toMatchObject({
      inputTokens: 150 + 80 + 120,
      outputTokens: 50 + 40 + 60,
      cacheTokens: 50 + 20 + 20,
      totalTokens: 250 + 140 + 200
    })
    expect(oneHour.summaries.find((entry) => entry.window === 'all')).toMatchObject({
      totalTokens: 1050 + 510
    })
  })

  it('produces per-model breakdowns per account per CLI across 1h, 5h, 7d and all windows', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'mistral',
      [
        {
          source: 's1',
          home: null,
          session: 'org+u',
          buckets: [
            dayBucket('2026-11-10', 'old-model', 1000, 500, 0),
            dayBucket('2026-11-25', 'model-big', 400, 200, 100),
            dayBucket('2026-11-25', 'model-small', 50, 25, 0)
          ],
          hourlyBuckets: [
            hourlyBucket('2026-11-10T10', 'old-model', 1000, 500, 0),
            hourlyBucket('2026-11-25T19', 'model-big', 300, 150, 80),
            hourlyBucket('2026-11-25T21', 'model-big', 100, 50, 20),
            hourlyBucket('2026-11-25T21', 'model-small', 50, 25, 0)
          ]
        }
      ],
      certain('acct-1', 'work@example.com'),
      NOW_MS
    )

    const snap1h = summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS)
    expect(snap1h.rows).toHaveLength(1)
    expect(
      snap1h.rows[0].models.map((m) => [
        m.model,
        m.inputTokens,
        m.outputTokens,
        m.cacheTokens,
        m.totalTokens
      ])
    ).toEqual([
      ['model-big', 100, 50, 20, 170],
      ['model-small', 50, 25, 0, 75]
    ])

    const snap5h = summarizeAccountUsageWindows(state, '5h', allSaved, NOW_MS)
    expect(snap5h.rows[0].models.map((m) => [m.model, m.totalTokens])).toEqual([
      ['model-big', 700],
      ['model-small', 75]
    ])
    expect(snap5h.hourly.map((point) => [point.hour, point.totalTokens])).toEqual([
      ['2026-11-25T19', 530],
      ['2026-11-25T21', 245]
    ])

    const snap7d = summarizeAccountUsageWindows(state, '7d', allSaved, NOW_MS)
    expect(snap7d.rows[0].totalTokens).toBe(775)
    expect(snap7d.rows[0].models.map((m) => m.model)).toEqual(['model-big', 'model-small'])

    const snapAll = summarizeAccountUsageWindows(state, 'all', allSaved, NOW_MS)
    expect(snapAll.rows[0].totalTokens).toBe(2275)
    expect(snapAll.rows[0].models.map((m) => m.model)).toEqual([
      'old-model',
      'model-big',
      'model-small'
    ])
  })

  it('preserves legacy v2 ledger JSON daily history in 7d/all while recording new hourly deltas', () => {
    const legacyState: AccountUsageLedgerState = {
      version: 2,
      updatedAt: TWO_HOURS_AGO_MS,
      providers: {
        codex: {
          sources: {
            '/tmp/rollout.jsonl': {
              owner: 'codex-1',
              seen: {
                '2026-11-24::gpt-5': dayBucket('2026-11-24', 'gpt-5', 2000, 1000, 500)
              }
            }
          },
          accounts: {
            'codex-1': {
              label: 'dev@example.com',
              sources: ['/tmp/rollout.jsonl'],
              buckets: {
                '2026-11-24::gpt-5': dayBucket('2026-11-24', 'gpt-5', 2000, 1000, 500)
              }
            }
          }
        }
      }
    }

    const beforeNew = summarizeAccountUsageWindows(legacyState, '7d', allSaved, NOW_MS)
    expect(beforeNew.rows[0]?.totalTokens).toBe(3500)
    expect(beforeNew.summaries.find((s) => s.window === '1h')?.totalTokens).toBe(0)

    const updated = recordSourceRollups(
      legacyState,
      'codex',
      [
        {
          source: '/tmp/rollout.jsonl',
          home: null,
          session: null,
          buckets: [
            dayBucket('2026-11-24', 'gpt-5', 2000, 1000, 500),
            dayBucket('2026-11-25', 'gpt-5', 300, 100, 50)
          ]
        }
      ],
      certain('codex-1', 'dev@example.com'),
      NOW_MS
    )

    const snap1h = summarizeAccountUsageWindows(updated, '1h', allSaved, NOW_MS)
    expect(snap1h.rows[0]?.totalTokens).toBe(450)
    const snapAll = summarizeAccountUsageWindows(updated, 'all', allSaved, NOW_MS)
    expect(snapAll.rows[0]?.totalTokens).toBe(3950)
  })

  it('removes a single model or whole account without re-crediting existing logs, while crediting new growth', () => {
    const initialRollup: UsageSourceRollup = {
      source: 'vibe-1',
      home: null,
      session: 'org+u',
      buckets: [
        dayBucket('2026-11-25', 'model-a', 100, 50, 10),
        dayBucket('2026-11-25', 'model-b', 200, 80, 20)
      ],
      hourlyBuckets: [
        hourlyBucket('2026-11-25T21', 'model-a', 100, 50, 10),
        hourlyBucket('2026-11-25T21', 'model-b', 200, 80, 20)
      ]
    }
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'mistral',
      [initialRollup],
      certain('acct-1'),
      NOW_MS
    )

    // Remove only model-a.
    state = removeAccountUsageEntry(
      state,
      { provider: 'mistral', accountKey: 'acct-1', model: 'model-a' },
      NOW_MS + 1000
    )
    expect(
      summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS).rows[0]?.models.map(
        (m) => m.model
      )
    ).toEqual(['model-b'])

    // Re-scanning the exact same logs must NOT re-credit model-a.
    state = recordSourceRollups(state, 'mistral', [initialRollup], certain('acct-1'), NOW_MS + 2000)
    expect(
      summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS).rows[0]?.models.map(
        (m) => m.model
      )
    ).toEqual(['model-b'])

    // Remove the entire account.
    state = removeAccountUsageEntry(
      state,
      { provider: 'mistral', accountKey: 'acct-1' },
      NOW_MS + 3000
    )
    expect(summarizeAccountUsageWindows(state, 'all', allSaved, NOW_MS).rows).toEqual([])

    // Re-scanning identical logs still credits nothing.
    state = recordSourceRollups(state, 'mistral', [initialRollup], certain('acct-1'), NOW_MS + 4000)
    expect(summarizeAccountUsageWindows(state, 'all', allSaved, NOW_MS).rows).toEqual([])

    // Genuinely new growth above the seen high-water marks IS credited.
    const grownRollup: UsageSourceRollup = {
      source: 'vibe-1',
      home: null,
      session: 'org+u',
      buckets: [
        dayBucket('2026-11-25', 'model-a', 140, 60, 10),
        dayBucket('2026-11-25', 'model-b', 200, 80, 20)
      ],
      hourlyBuckets: [
        hourlyBucket('2026-11-25T21', 'model-a', 140, 60, 10),
        hourlyBucket('2026-11-25T21', 'model-b', 200, 80, 20)
      ]
    }
    state = recordSourceRollups(state, 'mistral', [grownRollup], certain('acct-1'), NOW_MS + 5000)
    const afterGrowth = summarizeAccountUsageWindows(state, '1h', allSaved, NOW_MS)
    expect(afterGrowth.rows).toHaveLength(1)
    expect(afterGrowth.rows[0].models).toEqual([
      expect.objectContaining({
        model: 'model-a',
        inputTokens: 40,
        outputTokens: 10,
        cacheTokens: 0,
        totalTokens: 50
      })
    ])
  })

  it('splits multi-hour cumulative Mistral Vibe projection_delta records into exact hourlyBuckets summing to session total', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-vibe-hourly-'))
    try {
      const vibeHome = join(root, '.vibe')
      const dir = join(vibeHome, 'logs', 'session', 'unified', 'multi-hour')
      mkdirSync(join(dir, 'journal'), { recursive: true })
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({ config: { active_model: 'devstral-2' } })
      )
      writeFileSync(
        join(dir, 'owner.json'),
        JSON.stringify({ account: { organizationId: 'org-1', userId: 'u-1' } })
      )
      const record = (cached: number, input: number, output: number, updatedAt: number) =>
        `${JSON.stringify({
          type: 'projection_delta',
          payload: {
            delta: [
              {
                op: 'set_envelope',
                state: {
                  session: {
                    tokenUsage: {
                      cachedInputTokens: cached,
                      inputTokens: input,
                      outputTokens: output,
                      totalTokens: input + output
                    },
                    updatedAt
                  }
                }
              }
            ]
          }
        })}\n`

      const h1 = Date.UTC(2026, 10, 25, 18, 10, 0)
      const h1Later = Date.UTC(2026, 10, 25, 18, 45, 0)
      const h2 = Date.UTC(2026, 10, 25, 20, 5, 0)
      writeFileSync(
        join(dir, 'journal', '000001.jsonl'),
        record(10, 100, 40, h1) + record(30, 160, 70, h1Later) + record(90, 300, 150, h2)
      )

      const [rollup] = collectMistralVibeUsage(vibeHome)
      expect(rollup.hourlyBuckets).toEqual([
        expect.objectContaining({
          hour: '2026-11-25T18',
          model: 'devstral-2',
          inputTokens: 130,
          outputTokens: 70,
          cacheTokens: 30,
          totalTokens: 230
        }),
        expect.objectContaining({
          hour: '2026-11-25T20',
          model: 'devstral-2',
          inputTokens: 80,
          outputTokens: 80,
          cacheTokens: 60,
          totalTokens: 220
        })
      ])
      const hourlyTotal = (rollup.hourlyBuckets ?? []).reduce((sum, b) => sum + b.totalTokens, 0)
      const dailyTotal = rollup.buckets.reduce((sum, b) => sum + b.totalTokens, 0)
      // Cumulative highest record was input=300 (of which 90 cached => 210 fresh) + output=150 = 450.
      expect(hourlyTotal).toBe(450)
      expect(dailyTotal).toBe(450)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not double-count OpenCode cacheWriteInputTokens in account-usage-buckets', () => {
    const bucket = openCodeAggregateBucket({
      day: '2026-11-25',
      model: 'anthropic/claude-sonnet-4',
      projectKey: 'proj',
      projectLabel: 'proj',
      repoId: null,
      worktreeId: null,
      inputTokens: 1000,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 200,
      outputTokens: 300,
      reasoningOutputTokens: 0,
      totalTokens: 1300,
      eventCount: 2,
      estimatedCostUsd: 0.05
    })
    expect(bucket.inputTokens).toBe(400)
    expect(bucket.cacheTokens).toBe(600)
    expect(bucket.outputTokens).toBe(300)
    expect(bucket.totalTokens).toBe(1300)
  })
})
