import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { buildUsageRosterAccounts, type UsageRosterAccountSettings } from './usage-roster-accounts'

function claudeLimits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

function claudeAccount(id: string, email: string, runtime: 'host' | 'wsl' = 'host') {
  return {
    id,
    email,
    managedAuthPath: `/accounts/${id}`,
    managedAuthRuntime: runtime,
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

function settingsWith(
  accounts: ReturnType<typeof claudeAccount>[],
  activeId: string | null
): UsageRosterAccountSettings {
  return {
    claudeManagedAccounts: accounts,
    activeClaudeManagedAccountId: activeId,
    codexManagedAccounts: [],
    activeCodexManagedAccountId: null
  }
}

describe('buildUsageRosterAccounts', () => {
  it('lists the active account first, then every other host account with its cached usage', () => {
    const state = createEmptyRateLimitState({
      claude: claudeLimits(40),
      inactiveClaudeAccounts: [
        { accountId: 'a', rateLimits: claudeLimits(90), updatedAt: 0, isFetching: false }
      ]
    })

    const { claude } = buildUsageRosterAccounts(
      settingsWith(
        [
          claudeAccount('a', 'a@x.dev'),
          claudeAccount('b', 'b@x.dev'),
          claudeAccount('w', 'w@x.dev', 'wsl')
        ],
        'b'
      ),
      state,
      'System default'
    )

    expect(claude?.map((account) => [account.label, account.active])).toEqual([
      ['b@x.dev', true],
      ['a@x.dev', false]
    ])
    expect(claude?.[0].limits?.session?.usedPercent).toBe(40)
    expect(claude?.[1].limits?.session?.usedPercent).toBe(90)
  })

  it('names System default when no saved account is active', () => {
    const state = createEmptyRateLimitState({ claude: claudeLimits(10) })

    const { claude } = buildUsageRosterAccounts(
      settingsWith([claudeAccount('a', 'a@x.dev')], null),
      state,
      'System default'
    )

    expect(claude?.map((account) => account.label)).toEqual(['System default', 'a@x.dev'])
  })

  it('adds no breakdown for a single account', () => {
    const state = createEmptyRateLimitState({ claude: claudeLimits(10) })

    const result = buildUsageRosterAccounts(
      settingsWith([claudeAccount('a', 'a@x.dev')], 'a'),
      state,
      'System default'
    )

    expect(result.claude).toBeUndefined()
  })
})
