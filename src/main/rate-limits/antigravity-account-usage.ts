import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AntigravityAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import { writeFileAtomically } from '../codex-accounts/fs-utils'

export type AntigravityAccountsSnapshot = {
  activeAccountId: string | null
  accounts: { id: string; email: string | null }[]
}

export type AntigravityAccountsReader = () => Promise<AntigravityAccountsSnapshot | null>

function isAntigravityReading(value: unknown): value is ProviderRateLimits {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    value.provider === 'antigravity' &&
    'status' in value &&
    value.status === 'ok'
  )
}

/**
 * agy reads one OS-keyring login, so only the active account can be measured. Each reading is
 * kept under the account that was active for the whole fetch, so switching accounts later still
 * shows the others' last known usage.
 */
export class AntigravityAccountUsageTracker {
  private readings: Map<string, ProviderRateLimits> | null = null
  private accounts: AntigravityAccountsSnapshot | null = null

  constructor(private readonly cachePath: () => string | null) {}

  async track(
    read: AntigravityAccountsReader | null,
    fetch: () => Promise<ProviderRateLimits>
  ): Promise<ProviderRateLimits> {
    const before = read ? await read().catch(() => null) : null
    const reading = await fetch()
    const after = read ? await read().catch(() => null) : null
    this.accounts = after ?? before ?? this.accounts
    const activeId = before?.activeAccountId
    // Why both reads: a switch during the probe would file one account's quota under another.
    if (reading.status === 'ok' && activeId && after?.activeAccountId === activeId) {
      const readings = this.load()
      readings.set(activeId, reading)
      this.persist(readings, after)
    }
    return reading
  }

  /** undefined when no Antigravity account is saved, so the meter keeps its single-account form. */
  list(current: ProviderRateLimits | null): AntigravityAccountUsage[] | undefined {
    const accounts = this.accounts
    if (!accounts || accounts.accounts.length === 0) {
      return undefined
    }
    const readings = this.load()
    return accounts.accounts.map((account) => {
      const active = account.id === accounts.activeAccountId
      return {
        accountId: account.id,
        email: account.email,
        active,
        rateLimits: active ? current : (readings.get(account.id) ?? null)
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
          if (isAntigravityReading(value)) {
            this.readings.set(id, value)
          }
        }
      }
    } catch {
      // A damaged cache only loses last readings; the next fetch rewrites it.
    }
    return this.readings
  }

  private persist(
    readings: Map<string, ProviderRateLimits>,
    accounts: AntigravityAccountsSnapshot
  ) {
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
      console.warn('[rate-limits] Could not save Antigravity account usage:', error)
    }
  }
}
