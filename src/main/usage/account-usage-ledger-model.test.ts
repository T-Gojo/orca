import { describe, expect, it } from 'vitest'
import type { AccountUsageBucket } from '../../shared/account-usage-ledger-types'
import {
  emptyAccountUsageLedger,
  recordSourceRollups,
  summarizeAccountUsageLedger,
  type ResolvedSourceAccount
} from './account-usage-ledger-model'

function bucket(day: string, totalTokens: number): AccountUsageBucket {
  return {
    day,
    model: 'claude-sonnet-4',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    activity: 1,
    costUsd: null
  }
}

const accountHome = '/data/claude-profiles/acct-1/home'
const sharedHome = '/Users/me/.claude'

function resolve(home: string): ResolvedSourceAccount {
  return home === accountHome
    ? { accountKey: 'acct-1', label: 'a@example.com', shared: false }
    : { accountKey: 'system-default', label: null, shared: true }
}

function totals(state: ReturnType<typeof emptyAccountUsageLedger>, saved = new Set(['acct-1'])) {
  return summarizeAccountUsageLedger(state, 'all', (_provider, key) => saved.has(key)).map(
    (row) => [row.accountKey, row.totalTokens, row.removed]
  )
}

describe('account usage ledger', () => {
  it('keeps a removed account’s recorded tokens when its transcripts disappear', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [{ home: accountHome, buckets: [bucket('2026-10-01', 100)] }],
      resolve,
      1
    )
    state = recordSourceRollups(state, 'claude', [], resolve, 2)
    expect(totals(state, new Set())).toEqual([['acct-1', 100, true]])
  })

  it('credits only growth, and does not recount a folder that comes back', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [{ home: accountHome, buckets: [bucket('2026-10-01', 100)] }],
      resolve,
      1
    )
    state = recordSourceRollups(
      state,
      'claude',
      [{ home: accountHome, buckets: [bucket('2026-10-01', 150)] }],
      resolve,
      2
    )
    state = recordSourceRollups(state, 'claude', [{ home: accountHome, buckets: [] }], resolve, 3)
    state = recordSourceRollups(
      state,
      'claude',
      [{ home: accountHome, buckets: [bucket('2026-10-01', 150)] }],
      resolve,
      4
    )
    expect(totals(state)).toEqual([['acct-1', 150, false]])
  })

  it('files history found in a shared folder on first sight as unattributed', () => {
    let state = recordSourceRollups(
      emptyAccountUsageLedger(),
      'claude',
      [{ home: sharedHome, buckets: [bucket('2026-10-01', 40)] }],
      resolve,
      1
    )
    state = recordSourceRollups(
      state,
      'claude',
      [{ home: sharedHome, buckets: [bucket('2026-10-01', 70)] }],
      resolve,
      2
    )
    expect(totals(state, new Set(['unattributed', 'system-default']))).toEqual([
      ['unattributed', 40, false],
      ['system-default', 30, false]
    ])
  })
})
