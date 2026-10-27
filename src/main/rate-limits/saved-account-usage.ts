import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProviderRateLimits, SavedAccountUsage } from '../../shared/rate-limit-types'
import { writeFileAtomically } from '../codex-accounts/fs-utils'

export type SavedAccountsSnapshot = {
  activeAccountId: string | null
  /** `authProvenance`: the identity a reading of this account carries, when the provider names one. */
  accounts: { id: string; email: string | null; authProvenance?: string | null }[]
}

export type SavedAccountsReader = () => Promise<SavedAccountsSnapshot | null>

/** Reads one saved account's usage without switching to it; null when it cannot. */
export type SavedAccountUsageProbe = (accountId: string) => Promise<ProviderRateLimits | null>

function isReading(
  provider: ProviderRateLimits['provider'],
  value: unknown
): value is ProviderRateLimits {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    value.provider === provider &&
    'status' in value &&
    value.status === 'ok'
  )
}

/** A reading names another account than the active one (e.g. Kiro IDE's login beside kiro-cli's). */
function readsAnotherAccount(
  reading: ProviderRateLimits | null,
  accounts: SavedAccountsSnapshot,
  accountId: string
): boolean {
  const expected = accounts.accounts.find((account) => account.id === accountId)?.authProvenance
  const actual = reading?.usageMetadata?.authProvenance
  return !!expected && !!actual && expected !== actual
}

/**
 * Agents like agy and kiro-cli hold one login, so only the active account is measured by the
 * provider's own fetch. Each reading is kept under the account that was active for the whole
 * fetch, so switching accounts later still shows the others' last known usage.
 */
export class SavedAccountUsageTracker {
  private readings: Map<string, ProviderRateLimits> | null = null
  private accounts: SavedAccountsSnapshot | null = null
  private inactiveRefresh: Promise<void> | null = null
  private probe: SavedAccountUsageProbe | null = null
  private onInactiveRead: (() => void) | null = null

  constructor(
    private readonly provider: ProviderRateLimits['provider'],
    private readonly cachePath: () => string | null
  ) {}

  useInactiveProbe(probe: SavedAccountUsageProbe, onRead: () => void): void {
    this.probe = probe
    this.onInactiveRead = onRead
  }

  /** `refresh`: the user asked, so every saved account is read again after the active one. */
  async track(
    read: SavedAccountsReader | null,
    fetch: () => Promise<ProviderRateLimits>,
    refresh = false
  ): Promise<ProviderRateLimits> {
    const before = read ? await read().catch(() => null) : null
    const reading = await fetch()
    const after = read ? await read().catch(() => null) : null
    this.accounts = after ?? before ?? this.accounts
    const activeId = before?.activeAccountId
    // Why both reads: a switch during the probe would file one account's quota under another.
    if (
      reading.status === 'ok' &&
      activeId &&
      after?.activeAccountId === activeId &&
      !readsAnotherAccount(reading, after, activeId)
    ) {
      const readings = this.load()
      readings.set(activeId, reading)
      this.persist(readings, after)
    }
    // Why after the active read: one CLI run at a time, and saved accounts never delay its meter.
    void this.refreshInactive(refresh).then(() => this.onInactiveRead?.())
    return reading
  }

  /**
   * Reads every other saved account, one at a time. A user refresh reads them all; other
   * cycles only fill accounts that have no reading yet.
   */
  refreshInactive(force: boolean): Promise<void> {
    const probe = this.probe
    if (!probe || !this.accounts) {
      return Promise.resolve()
    }
    this.inactiveRefresh ??= this.readInactive(probe, force, this.accounts).finally(() => {
      this.inactiveRefresh = null
    })
    return this.inactiveRefresh
  }

  private async readInactive(
    probe: SavedAccountUsageProbe,
    force: boolean,
    accounts: SavedAccountsSnapshot
  ): Promise<void> {
    const readings = this.load()
    let changed = false
    for (const account of accounts.accounts) {
      if (account.id === accounts.activeAccountId || (!force && readings.has(account.id))) {
        continue
      }
      const reading = await probe(account.id).catch(() => null)
      // Why keep an older success: a passing failure should not erase the last known quota.
      if (reading && (reading.status === 'ok' || readings.get(account.id)?.status !== 'ok')) {
        readings.set(account.id, reading)
        changed = true
      }
    }
    if (changed) {
      this.persist(readings, accounts)
    }
  }

  /** undefined when no account is saved, so the meter keeps its single-account form. */
  list(current: ProviderRateLimits | null): SavedAccountUsage[] | undefined {
    const accounts = this.accounts
    if (!accounts || accounts.accounts.length === 0) {
      return undefined
    }
    const readings = this.load()
    return accounts.accounts.map((account) => {
      const active = account.id === accounts.activeAccountId
      const live = active && !readsAnotherAccount(current, accounts, account.id)
      return {
        accountId: account.id,
        email: account.email,
        active,
        rateLimits: live ? current : (readings.get(account.id) ?? null)
      }
    })
  }

  private load(): Map<string, ProviderRateLimits> {
    if (this.readings) {
      return this.readings
    }
    this.readings = new Map()
    const path = this.cachePath()
    if (!path || !existsSync(path)) {
      return this.readings
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [id, value] of Object.entries(parsed)) {
          if (isReading(this.provider, value)) {
            this.readings.set(id, value)
          }
        }
      }
    } catch {
      // A damaged cache only loses last readings; the next fetch rewrites it.
    }
    return this.readings
  }

  private persist(readings: Map<string, ProviderRateLimits>, accounts: SavedAccountsSnapshot) {
    const saved = new Set(accounts.accounts.map((account) => account.id))
    for (const id of readings.keys()) {
      if (!saved.has(id)) {
        readings.delete(id)
      }
    }
    const path = this.cachePath()
    if (!path) {
      return
    }
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      writeFileAtomically(path, JSON.stringify(Object.fromEntries(readings)), { mode: 0o600 })
    } catch (error) {
      console.warn(`[rate-limits] Could not save ${this.provider} account usage:`, error)
    }
  }
}
