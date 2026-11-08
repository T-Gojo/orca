import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { isUsageProviderHidden } from './usage-provider-connection'

function limits(
  provider: ProviderRateLimits['provider'],
  failureKind?: NonNullable<ProviderRateLimits['usageMetadata']>['failureKind']
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: 1,
    error: failureKind ? 'failed' : null,
    status: failureKind ? 'error' : 'ok',
    ...(failureKind ? { usageMetadata: { failureKind } } : {})
  }
}

describe('isUsageProviderHidden', () => {
  it('hides agents turned off in Settings → Agents', () => {
    expect(isUsageProviderHidden('grok', limits('grok'), ['grok'])).toBe(true)
    expect(isUsageProviderHidden('grok', limits('grok'), [])).toBe(false)
  })

  it('hides a provider with no login but keeps one whose reading failed', () => {
    expect(isUsageProviderHidden('cursor', limits('cursor', 'stale-token'), [])).toBe(true)
    expect(isUsageProviderHidden('gemini', limits('gemini', 'missing-credentials'), [])).toBe(true)
    expect(isUsageProviderHidden('gemini', limits('gemini', 'network'), [])).toBe(false)
    // Claude reports stale-token while a live session holds the login.
    expect(isUsageProviderHidden('claude', limits('claude', 'stale-token'), [])).toBe(false)
  })
})
