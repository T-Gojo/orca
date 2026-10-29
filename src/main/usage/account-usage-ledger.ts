import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AccountUsageLedgerRange,
  AccountUsageLedgerSnapshot,
  AccountUsageProvider,
  UsageSourceRollup
} from '../../shared/account-usage-ledger-types'
import {
  SYSTEM_DEFAULT_ACCOUNT_KEY,
  UNATTRIBUTED_ACCOUNT_KEY
} from '../../shared/account-usage-ledger-types'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  dailyAccountUsage,
  emptyAccountUsageLedger,
  recordSourceRollups,
  summarizeAccountUsageLedger,
  type AccountUsageLedgerState
} from './account-usage-ledger-model'
import {
  createSourceResolver,
  type LedgerSettings,
  type SingleLoginAccounts
} from './account-usage-source-owners'

export type SingleLoginAccountReaders = Record<
  'kiro' | 'antigravity',
  () => Promise<SingleLoginAccounts | null>
>

function isLedgerState(value: unknown): value is AccountUsageLedgerState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 2 &&
    'providers' in value
  )
}

/** Per-account usage history that only grows, so removing an account keeps what it used. */
export class AccountUsageLedger {
  private state: AccountUsageLedgerState = emptyAccountUsageLedger()
  private readonly loaded: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  private records: Promise<void> = Promise.resolve()
  private readonly savedSingleLogin: Partial<Record<'kiro' | 'antigravity', Set<string>>> = {}

  constructor(
    private readonly getSettings: () => LedgerSettings,
    private readonly singleLogin: SingleLoginAccountReaders,
    private readonly file = join(app.getPath('userData'), 'orca-account-usage-ledger.json')
  ) {
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf-8'))
      if (isLedgerState(parsed)) {
        this.state = parsed
      }
    } catch {
      // Missing, unreadable or an older layout: start over; history already logged is unattributed.
    }
  }

  private async readSingleLogin(provider: AccountUsageProvider) {
    if (provider !== 'kiro' && provider !== 'antigravity') {
      return null
    }
    const accounts = await this.singleLogin[provider]().catch(() => null)
    if (accounts) {
      this.savedSingleLogin[provider] = new Set(accounts.accounts.map((account) => account.id))
    }
    return accounts
  }

  /** Serialized so two collections never credit the same growth twice. */
  record(provider: AccountUsageProvider, rollups: readonly UsageSourceRollup[]): Promise<void> {
    const next = this.records.then(async () => {
      await this.loaded
      const resolve = createSourceResolver(
        provider,
        this.getSettings(),
        await this.readSingleLogin(provider)
      )
      this.state = recordSourceRollups(this.state, provider, rollups, resolve, Date.now())
      const payload = JSON.stringify(this.state)
      this.writes = this.writes
        .catch(() => {})
        .then(() => writeFileDurable(durableWriteTempPath(this.file), this.file, payload))
      await this.writes.catch((error) => console.warn('[account-usage] Could not save:', error))
    })
    this.records = next.catch(() => {})
    return next
  }

  private isSaved(provider: AccountUsageProvider, accountKey: string): boolean {
    if (accountKey === SYSTEM_DEFAULT_ACCOUNT_KEY || accountKey === UNATTRIBUTED_ACCOUNT_KEY) {
      return true
    }
    const settings = this.getSettings()
    switch (provider) {
      case 'claude':
        return settings.claudeManagedAccounts.some((account) => account.id === accountKey)
      case 'codex':
        return settings.codexManagedAccounts.some((account) => account.id === accountKey)
      case 'kiro':
      case 'antigravity':
        // Unknown until the account list is read; never mark a row removed on a guess.
        return this.savedSingleLogin[provider]?.has(accountKey) ?? true
      case 'opencode':
        return true
    }
  }

  async getSnapshot(range: AccountUsageLedgerRange): Promise<AccountUsageLedgerSnapshot> {
    await this.loaded
    await this.records
    return {
      range,
      updatedAt: this.state.updatedAt,
      rows: summarizeAccountUsageLedger(this.state, range, (provider, key) =>
        this.isSaved(provider, key)
      ),
      daily: dailyAccountUsage(this.state, range)
    }
  }
}
