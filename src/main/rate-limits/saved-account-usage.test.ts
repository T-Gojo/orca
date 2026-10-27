import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { SavedAccountUsageTracker, type SavedAccountsSnapshot } from './saved-account-usage'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-antigravity-usage-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function reading(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'antigravity',
    session: null,
    weekly: { usedPercent, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

function accounts(activeAccountId: string): SavedAccountsSnapshot {
  return {
    activeAccountId,
    accounts: [
      { id: 'a', email: 'a@x.dev' },
      { id: 'b', email: 'b@x.dev' }
    ]
  }
}

describe('SavedAccountUsageTracker', () => {
  it("keeps each account's last reading after switching, and across a restart", async () => {
    const cache = join(dir, 'usage-cache.json')
    const tracker = new SavedAccountUsageTracker('antigravity', () => cache)
    await tracker.track(
      async () => accounts('a'),
      async () => reading(40)
    )
    await tracker.track(
      async () => accounts('b'),
      async () => reading(10)
    )

    const listed = tracker.list(reading(10))
    expect(
      listed?.map((entry) => [entry.email, entry.active, entry.rateLimits?.weekly?.usedPercent])
    ).toEqual([
      ['a@x.dev', false, 40],
      ['b@x.dev', true, 10]
    ])

    const restarted = new SavedAccountUsageTracker('antigravity', () => cache)
    await restarted.track(
      async () => accounts('b'),
      async () => reading(12)
    )
    expect(restarted.list(reading(12))?.[0].rateLimits?.weekly?.usedPercent).toBe(40)
  })

  it('does not file a reading when the account switched during the fetch', async () => {
    const tracker = new SavedAccountUsageTracker('antigravity', () => join(dir, 'usage-cache.json'))
    let active = 'a'
    await tracker.track(
      async () => accounts(active),
      async () => {
        active = 'b'
        return reading(90)
      }
    )

    expect(tracker.list(null)?.find((entry) => entry.accountId === 'a')?.rateLimits).toBeNull()
  })

  it('reads the saved accounts on a refresh, and only unread ones otherwise', async () => {
    const tracker = new SavedAccountUsageTracker('antigravity', () => join(dir, 'usage-cache.json'))
    await tracker.track(
      async () => accounts('a'),
      async () => reading(40)
    )
    const probed: string[] = []
    const probe = async (id: string) => {
      probed.push(id)
      return reading(70)
    }

    tracker.useInactiveProbe(probe, () => {})
    await tracker.refreshInactive(false)
    await tracker.refreshInactive(false)
    await tracker.refreshInactive(true)

    expect(probed).toEqual(['b', 'b'])
    expect(tracker.list(reading(40))?.[1].rateLimits?.weekly?.usedPercent).toBe(70)
  })

  it("never files another login's reading under the active account", async () => {
    const tracker = new SavedAccountUsageTracker('kiro', () => join(dir, 'usage-cache.json'))
    const kiroAccounts = async (): Promise<SavedAccountsSnapshot> => ({
      activeAccountId: 'a',
      accounts: [{ id: 'a', email: 'a@x.dev', authProvenance: 'user-a' }]
    })
    const ideReading: ProviderRateLimits = {
      ...reading(80),
      provider: 'kiro',
      usageMetadata: { authProvenance: 'user-ide' }
    }

    await tracker.track(kiroAccounts, async () => ideReading)

    expect(tracker.list(ideReading)?.[0].rateLimits).toBeNull()
  })
})
