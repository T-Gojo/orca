import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
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
import type { GlobalSettings } from '../../shared/global-settings-types'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import { resolveOrcaManagedCodexHomePath } from '../codex/codex-home-paths'
import { setUsageSourceRollupListener } from './usage-scan-worker-spawn'
import {
  emptyAccountUsageLedger,
  recordSourceRollups,
  summarizeAccountUsageLedger,
  type AccountUsageLedgerState,
  type ResolvedSourceAccount
} from './account-usage-ledger-model'

type LedgerSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'codexManagedAccounts'
  | 'activeCodexManagedAccountId'
  | 'activeCodexManagedAccountIdsByRuntime'
>

/** `<root>/<folder>/<id>/home`: Orca's per-account folder layout for both agents. */
function accountIdFromHome(home: string, folder: string): string | null {
  const accountDir = dirname(home)
  return basename(home) === 'home' && basename(dirname(accountDir)) === folder
    ? basename(accountDir)
    : null
}

function withDetail(email: string, detail: string | null | undefined): string {
  return detail ? `${email} · ${detail}` : email
}

function isLedgerState(value: unknown): value is AccountUsageLedgerState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'observed' in value &&
    'accounts' in value
  )
}

/** Per-account token history that only grows, so removing an account keeps what it used. */
export class AccountUsageLedger {
  private state: AccountUsageLedgerState = emptyAccountUsageLedger()
  private readonly loaded: Promise<void>
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly getSettings: () => LedgerSettings,
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
      // Missing or unreadable: start empty; the next scan records current totals as unattributed.
    }
  }

  private resolve(provider: AccountUsageProvider, home: string): ResolvedSourceAccount {
    const settings = this.getSettings()
    if (provider === 'claude') {
      const id = accountIdFromHome(home, 'claude-profiles')
      const account = id ? settings.claudeManagedAccounts.find((entry) => entry.id === id) : null
      return id
        ? {
            accountKey: id,
            label: account ? withDetail(account.email, account.organizationName) : null,
            shared: false
          }
        : { accountKey: SYSTEM_DEFAULT_ACCOUNT_KEY, label: null, shared: true }
    }
    const id = accountIdFromHome(home, 'codex-accounts')
    // The runtime home runs whichever account is selected, so new usage goes to that account.
    const runtimeAccountId =
      resolvePath(home) === resolvePath(resolveOrcaManagedCodexHomePath())
        ? (settings.activeCodexManagedAccountIdsByRuntime?.host ??
          settings.activeCodexManagedAccountId ??
          null)
        : null
    const accountId = id ?? runtimeAccountId
    const account = accountId
      ? settings.codexManagedAccounts.find((entry) => entry.id === accountId)
      : null
    return {
      accountKey: accountId ?? SYSTEM_DEFAULT_ACCOUNT_KEY,
      label: account ? withDetail(account.email, account.workspaceLabel) : null,
      shared: id === null
    }
  }

  async record(provider: AccountUsageProvider, rollups: readonly UsageSourceRollup[]) {
    await this.loaded
    this.state = recordSourceRollups(
      this.state,
      provider,
      rollups,
      (home) => this.resolve(provider, home),
      Date.now()
    )
    const payload = JSON.stringify(this.state)
    this.writes = this.writes
      .catch(() => {})
      .then(() => writeFileDurable(durableWriteTempPath(this.file), this.file, payload))
    await this.writes.catch((error) => console.warn('[account-usage] Could not save:', error))
  }

  async getSnapshot(range: AccountUsageLedgerRange): Promise<AccountUsageLedgerSnapshot> {
    await this.loaded
    const settings = this.getSettings()
    const saved = {
      claude: new Set(settings.claudeManagedAccounts.map((account) => account.id)),
      codex: new Set(settings.codexManagedAccounts.map((account) => account.id))
    }
    return {
      range,
      updatedAt: this.state.updatedAt,
      rows: summarizeAccountUsageLedger(
        this.state,
        range,
        (provider, accountKey) =>
          accountKey === SYSTEM_DEFAULT_ACCOUNT_KEY ||
          accountKey === UNATTRIBUTED_ACCOUNT_KEY ||
          saved[provider].has(accountKey)
      )
    }
  }
}

let installed: AccountUsageLedger | null = null

/** Desktop process only: Claude and Codex scans feed one ledger. */
export function installAccountUsageLedger(getSettings: () => LedgerSettings): AccountUsageLedger {
  const ledger = new AccountUsageLedger(getSettings)
  setUsageSourceRollupListener((provider, rollups) => ledger.record(provider, rollups))
  installed = ledger
  return ledger
}

export function getAccountUsageLedger(): AccountUsageLedger | null {
  return installed
}
