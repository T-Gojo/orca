import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
import { kiroLoginRow } from './delegation-usage'

const login: ProviderRateLimits = {
  provider: 'kiro',
  session: null,
  weekly: null,
  monthly: {
    usedPercent: 6,
    windowMinutes: 43_200,
    resetsAt: 1_800_000_000_000,
    resetDescription: null
  },
  updatedAt: 1_799_000_000_000,
  error: null,
  status: 'ok'
}

describe('kiroLoginRow', () => {
  it('offers kiro-cli’s own login as `system` when it is not a saved account', () => {
    const [row] = kiroLoginRow({ kiro: login, kiroAccounts: [] }, 'me@example.invalid', 90)

    expect(row).toMatchObject({
      agent: 'kiro',
      accountId: null,
      label: 'me@example.invalid',
      usedPercent: 6,
      available: true
    })
  })

  it('leaves it out when the login is one of the saved accounts', () => {
    const saved = { accountId: 'k1', email: null, active: true, rateLimits: login }

    expect(kiroLoginRow({ kiro: login, kiroAccounts: [saved] }, null, 90)).toEqual([])
  })
})
