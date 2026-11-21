import { describe, expect, it } from 'vitest'
import type { DelegationAccountUsage } from '../../shared/delegation/delegation-types'
import { routeDelegation } from './delegation-route'

const preferences = {
  agentOrder: ['antigravity' as const, 'kiro' as const],
  models: { kiro: 'claude-sonnet-4.5' },
  maxUsedPercent: 90,
  kinds: { review: { agents: ['kiro' as const] } },
  autoDelegation: { enabled: true, ownUsedPercent: 70 }
}

function account(
  agent: DelegationAccountUsage['agent'],
  accountId: string,
  usedPercent: number | null,
  available = true
): DelegationAccountUsage {
  return {
    agent,
    accountId,
    label: `${accountId}@example.invalid`,
    active: false,
    usedPercent,
    windows: [],
    readAt: null,
    error: null,
    available
  }
}

describe('routeDelegation', () => {
  it('takes the first preferred agent with room, on its least-used account', () => {
    const result = routeDelegation(preferences, [
      account('antigravity', 'full', 95, false),
      account('antigravity', 'busy', 60),
      account('antigravity', 'idle', 10),
      account('kiro', 'k1', 0)
    ])

    expect(result.status).toBe('routed')
    if (result.status === 'routed') {
      expect(result.route.accountId).toBe('idle')
      expect(result.route.workerStartFlags).toEqual(['--agent antigravity', '--account idle'])
      expect(result.alternatives.map((route) => route.accountId)).toEqual(['busy', 'k1'])
    }
  })

  it('falls through to the next agent when every account of the first is exhausted', () => {
    const result = routeDelegation(preferences, [
      account('antigravity', 'full', 99, false),
      account('kiro', 'k1', 40)
    ])

    expect(result.status === 'routed' && result.route.workerStartFlags).toEqual([
      '--agent kiro',
      '--account k1',
      '--model claude-sonnet-4.5'
    ])
  })

  it('uses a kind’s own agent order and reports exhaustion', () => {
    const result = routeDelegation(
      preferences,
      [account('antigravity', 'idle', 0), account('kiro', 'k1', 95, false)],
      { kind: 'review' }
    )

    expect(result.status).toBe('exhausted')
  })
})
