import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchKiroRateLimits } from './kiro-usage-fetcher'
import type { KiroAuthReadResult } from './kiro-auth'

vi.mock('../foreign-sqlite-readers/foreign-sqlite-reader-spawn', () => ({
  readKiroCliToken: vi.fn()
}))

const NOW = new Date('2026-10-24T10:00:00.000Z')

function signedIn(expiresAt: string | null): KiroAuthReadResult {
  return {
    status: 'ok',
    session: {
      accessToken: 'test-token',
      expiresAtMs: expiresAt === null ? null : Date.parse(expiresAt),
      region: 'us-east-1',
      source: 'cli'
    }
  }
}

// Shape captured from getUsageLimits for a Kiro Pro+ account.
const PRO_PLUS_RESPONSE = {
  nextDateReset: 1.7934912e9,
  subscriptionInfo: { subscriptionTitle: 'KIRO PRO+' },
  usageBreakdownList: [
    {
      resourceType: 'CREDIT',
      currentUsage: 500,
      currentUsageWithPrecision: 500.5,
      usageLimit: 2000,
      usageLimitWithPrecision: 2000,
      nextDateReset: 1.7934912e9,
      bonuses: [{ status: 'ACTIVE', currentUsage: 0, usageLimit: 500 }],
      freeTrialInfo: null
    }
  ]
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchKiroRateLimits', () => {
  it('maps the credit pool plus active bonus credits to a monthly window', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(PRO_PLUS_RESPONSE))

    const result = await fetchKiroRateLimits({
      authReadResult: signedIn('2026-10-24T11:00:00.000Z')
    })

    expect(result.status).toBe('ok')
    expect(result.planType).toBe('KIRO PRO+')
    expect(result.monthly?.usedPercent).toBeCloseTo((500.5 / 2500) * 100)
    expect(result.monthly?.resetsAt).toBe(1_793_491_200_000)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(
      'https://q.us-east-1.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST'
    )
    expect(init?.redirect).toBe('error')
  })

  it('asks the user to run Kiro instead of calling the API with an expired token', async () => {
    const result = await fetchKiroRateLimits({
      authReadResult: signedIn('2026-10-24T09:00:00.000Z')
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(result.status).toBe('error')
    expect(result.usageMetadata?.failureKind).toBe('delegated-refresh-required')
  })

  it('treats a rejected token as a sign-in Kiro must refresh', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 403 }))

    const result = await fetchKiroRateLimits({ authReadResult: signedIn(null) })

    expect(result.usageMetadata?.failureKind).toBe('delegated-refresh-required')
  })

  it('hides the meter when no Kiro login exists', async () => {
    const result = await fetchKiroRateLimits({ authReadResult: { status: 'missing' } })

    expect(result.status).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
})
