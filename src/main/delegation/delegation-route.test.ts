import { describe, expect, it } from 'vitest'
import type {
  DelegationAccountUsage,
  DelegationPreferences,
  DelegationUsageWindow
} from '../../shared/delegation/delegation-types'
import { accountPace } from './delegation-pace'
import { routeDelegation } from './delegation-route'

const HOUR = 60 * 60 * 1000
const NOW = 1_800_000_000_000

const preferences: DelegationPreferences = {
  agentOrder: ['antigravity', 'kiro', 'codex', 'claude'],
  models: { kiro: 'claude-sonnet-4.5' },
  maxUsedPercent: 90,
  kinds: { review: { agents: ['kiro'] } },
  profiles: {
    antigravity: { tier: 'light' },
    kiro: { tier: 'standard' },
    codex: { tier: 'strong' },
    claude: { tier: 'strong' }
  },
  autoDelegation: { enabled: true, ownUsedPercent: 70 }
}

function weekly(usedPercent: number, resetsInHours: number): DelegationUsageWindow {
  return { name: 'weekly', usedPercent, resetsAt: NOW + resetsInHours * HOUR }
}

function account(
  agent: DelegationAccountUsage['agent'],
  accountId: string | null,
  windows: DelegationUsageWindow[],
  available = true
): DelegationAccountUsage {
  return {
    agent,
    accountId,
    label: accountId,
    active: false,
    usedPercent: windows.length ? Math.max(...windows.map((w) => w.usedPercent)) : null,
    windows,
    readAt: NOW,
    error: null,
    available
  }
}

describe('routeDelegation', () => {
  it('spends quota that would reset unused before a fresher, less-used account', () => {
    const result = routeDelegation(
      preferences,
      [
        account('antigravity', 'fresh', [weekly(0, 156)]),
        account('antigravity', 'ending', [weekly(10, 24)]),
        account('antigravity', 'full', [weekly(95, 24)], false)
      ],
      { now: NOW }
    )

    expect(result.status === 'routed' && result.route.accountId).toBe('ending')
    expect(result.status === 'routed' && result.alternatives.map((r) => r.accountId)).toEqual([
      'fresh'
    ])
  })

  it('only offers agents at or above the task’s tier, never the excluded own account', () => {
    const result = routeDelegation(
      preferences,
      [
        account('antigravity', 'a1', [weekly(0, 24)]),
        account('kiro', 'k1', [weekly(0, 24)]),
        account('claude', 'me', [weekly(0, 24)]),
        account('codex', null, [weekly(50, 100)])
      ],
      { tier: 'strong', exclude: ['claude:me'], now: NOW }
    )

    expect(result.status === 'routed' && result.route.workerStartFlags).toEqual([
      '--agent codex',
      '--account system'
    ])
    expect(result.status === 'routed' && result.alternatives).toEqual([])
  })

  it('reports exhaustion within a kind’s agents', () => {
    const result = routeDelegation(
      preferences,
      [account('antigravity', 'idle', []), account('kiro', 'k1', [weekly(95, 24)], false)],
      { kind: 'review', now: NOW }
    )

    expect(result.status).toBe('exhausted')
  })
})

describe('accountPace', () => {
  it('projects when the average rate so far runs a window out before it resets', () => {
    // 80% of a 5h window used 2h in: 40%/h leaves 20% for 30 minutes, 2.5h before the reset.
    const pace = accountPace(
      { windows: [{ name: 'session', usedPercent: 80, resetsAt: NOW + 3 * HOUR }] },
      NOW
    )

    expect(pace).toEqual({
      spare: 20,
      expiring: 0,
      exhaustsAt: NOW + HOUR / 2,
      exhaustingWindow: 'session'
    })
  })
})
