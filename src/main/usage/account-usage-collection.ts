import type { AccountUsageProvider } from '../../shared/account-usage-ledger-types'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { AccountUsageLedger } from './account-usage-ledger'
import { setBeforeAccountSwitchHook } from './account-switch-usage-hook'
import type { LedgerSettings } from './account-usage-source-owners'
import {
  collectAccountSourcesViaWorker,
  setUsageSourceRollupListener
} from './usage-scan-worker-spawn'

type RefreshableUsageStore = {
  getScanState: () => { enabled: boolean }
  refresh: (force?: boolean) => Promise<unknown>
}

type CollectionStores = Partial<Record<'claude' | 'codex' | 'opencode', RefreshableUsageStore>>

const FIRST_COLLECTION_DELAY_MS = 30_000
const COLLECTION_INTERVAL_MS = 10 * 60_000
const SWITCH_COLLECTION_TIMEOUT_MS = 8_000

let ledger: AccountUsageLedger | null = null
let stores: CollectionStores = {}
let collecting: Promise<void> | null = null

async function collectSingleLoginSources(): Promise<void> {
  if (!ledger) {
    return
  }
  const { kiro, antigravity } = await collectAccountSourcesViaWorker()
  await ledger.record('kiro', kiro)
  await ledger.record('antigravity', antigravity)
}

/** Read every agent's logs into the ledger; token stores report through the rollup listener. */
export function collectAccountUsage(
  options: { force?: boolean; only?: AccountUsageProvider } = {}
): Promise<void> {
  if (collecting && !options.only) {
    return collecting
  }
  const wanted = (provider: AccountUsageProvider): boolean =>
    options.only === undefined || options.only === provider
  const run = Promise.all([
    ...(['claude', 'codex', 'opencode'] as const).filter(wanted).map((provider) => {
      const store = stores[provider]
      return store?.getScanState().enabled
        ? store.refresh(options.force ?? false)
        : Promise.resolve()
    }),
    wanted('kiro') || wanted('antigravity') ? collectSingleLoginSources() : Promise.resolve()
  ])
    .then(() => {})
    .catch((error) => console.warn('[account-usage] Collection failed:', error))
  if (!options.only) {
    collecting = run.finally(() => {
      collecting = null
    })
    return collecting
  }
  return run
}

/**
 * Credit what the signed-in account used before its login changes. Why: kiro-cli, agy and the
 * Codex runtime home hold one login, so later reads would charge the next account.
 */
export async function collectAccountUsageBeforeSwitch(
  provider: AccountUsageProvider
): Promise<void> {
  if (!ledger) {
    return
  }
  await Promise.race([
    collectAccountUsage({ force: true, only: provider }),
    new Promise<void>((resolve) => setTimeout(resolve, SWITCH_COLLECTION_TIMEOUT_MS).unref?.())
  ])
}

/** Desktop process only: one ledger fed by every agent, collected in the background. */
export function installAccountUsageLedger(
  getSettings: () => LedgerSettings,
  usageStores: CollectionStores
): AccountUsageLedger {
  stores = usageStores
  ledger = new AccountUsageLedger(getSettings, {
    kiro: async () => {
      const state = await getKiroAccountService().listAccounts()
      return {
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        currentEmail: state.currentAccount?.email ?? null
      }
    },
    antigravity: async () => {
      const state = await getAntigravityAccountService({ runtime: 'host' }).listAccounts()
      return {
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        currentEmail: state.currentAccount?.email ?? null
      }
    }
  })
  const installed = ledger
  setBeforeAccountSwitchHook(collectAccountUsageBeforeSwitch)
  setUsageSourceRollupListener((provider, rollups) => installed.record(provider, rollups))
  setTimeout(() => {
    void collectAccountUsage()
    setInterval(() => void collectAccountUsage(), COLLECTION_INTERVAL_MS).unref()
  }, FIRST_COLLECTION_DELAY_MS).unref()
  return ledger
}

export function getAccountUsageLedger(): AccountUsageLedger | null {
  return ledger
}
