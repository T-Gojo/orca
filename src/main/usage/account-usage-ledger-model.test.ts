import { describe, expect, it } from 'vitest'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import {
  emptyAccountUsageLedger,
  recordSourceRollups,
  summarizeAccountUsageLedger,
  type AccountUsageLedgerState,
  type ResolvedSourceAccount
} from './account-usage-ledger-model'

function bucket(day: string, totalTokens: number, credits = 0): AccountUsageBucket {
  return {
    day,
    model: 'claude-sonnet-4',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    activity: 1,
    credits,
    costUsd: null
  }
}

function source(id: string, ...buckets: AccountUsageBucket[]): UsageSourceRollup {
  return { source: id, home: null, session: id, buckets }
}

const guess = (accountKey: string) => (): ResolvedSourceAccount => ({
  accountKey,
  label: `${accountKey}@example.com`,
  certain: false
})

function totals(state: AccountUsageLedgerState, saved = new Set(['a', 'b', 'unattributed'])) {
  return summarizeAccountUsageLedger(state, 'all', (_provider, key) => saved.has(key)).map(
    (row) => [row.accountKey, row.totalTokens, row.credits, row.removed]
  )
}

describe('account usage ledger', () => {
  it('files history found on the first collection as unattributed unless a session names its account', () => {
    const state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [source('old', bucket('2026-10-01', 40)), source('live', bucket('2026-10-01', 10))],
      (rollup) =>
        rollup.session === 'live'
          ? { accountKey: 'a', label: null, certain: true }
          : { accountKey: 'a', label: null, certain: false },
      1
    )
    expect(totals(state)).toEqual([
      ['unattributed', 40, 0, false],
      ['a', 10, 0, false]
    ])
  })

  it('keeps a removed account’s tokens when its logs disappear', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'kiro',
      [source('seed', bucket('2026-10-01', 1))],
      guess('a'),
      1
    )
    state = recordSourceRollups(
      state,
      'kiro',
      [source('s1', bucket('2026-10-02', 0, 12))],
      guess('a'),
      2
    )
    state = recordSourceRollups(state, 'kiro', [], guess('b'), 3)
    expect(totals(state, new Set(['unattributed']))).toEqual([
      ['unattributed', 1, 0, false],
      ['a', 0, 12, true]
    ])
  })

  it('credits growth once to the account that owned the session, even after a switch', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'antigravity',
      [source('seed')],
      guess('a'),
      1
    )
    state = recordSourceRollups(
      state,
      'antigravity',
      [source('s1', bucket('2026-10-01', 100))],
      guess('a'),
      2
    )
    state = recordSourceRollups(
      state,
      'antigravity',
      [source('s1', bucket('2026-10-01', 150))],
      guess('b'),
      3
    )
    state = recordSourceRollups(state, 'antigravity', [source('s1')], guess('b'), 4)
    state = recordSourceRollups(
      state,
      'antigravity',
      [source('s1', bucket('2026-10-01', 150))],
      guess('b'),
      5
    )
    state = recordSourceRollups(
      state,
      'antigravity',
      [source('s2', bucket('2026-10-01', 30))],
      guess('b'),
      6
    )
    expect(totals(state)).toEqual([
      ['a', 150, 0, false],
      ['b', 30, 0, false]
    ])
  })

  it('moves later growth to the account a session record names', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [source('seed')],
      guess('a'),
      1
    )
    state = recordSourceRollups(
      state,
      'claude',
      [source('s1', bucket('2026-10-01', 20))],
      guess('a'),
      2
    )
    state = recordSourceRollups(
      state,
      'claude',
      [source('s1', bucket('2026-10-01', 50))],
      () => ({ accountKey: 'b', label: null, certain: true }),
      3
    )
    expect(totals(state)).toEqual([
      ['b', 30, 0, false],
      ['a', 20, 0, false]
    ])
  })
})
