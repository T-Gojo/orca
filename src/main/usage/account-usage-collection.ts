import type {
  AccountSourceRollups,
  AccountUsageCollectRequest,
  AccountUsageProvider
} from '../../shared/account-usage-ledger-types'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { AccountUsageLedger } from './account-usage-ledger'
import { setBeforeAccountSwitchHook } from './account-switch-usage-hook'
import type { LedgerSettings } from './account-usage-source-owners'

/** The usage backend refreshes the token stores (their rollups reach `record`) and reads kiro/agy logs. */
type BackendCollector = (request: AccountUsageCollectRequest) => Promise<AccountSourceRollups>

const FIRST_COLLECTION_DELAY_MS = 30_000
const MIN_COLLECTION_GAP_MS = 10 * 60_000
const SWITCH_COLLECTION_TIMEOUT_MS = 8_000

let ledger: AccountUsageLedger | null = null
let collector: BackendCollector | null = null
let collecting: Promise<void> | null = null
let lastCollectedAt = 0

async function collectThroughBackend(request: AccountUsageCollectRequest): Promise<void> {
  if (!ledger || !collector) {
    return
  }
  const installed = ledger
  const { kiro, antigravity } = await collector(request)
  if (request.only === undefined || request.only === 'kiro') {
    await installed.record('kiro', kiro)
  }
  if (request.only === undefined || request.only === 'antigravity') {
    await installed.record('antigravity', antigravity)
  }
}

/** Read every agent's logs into the ledger; token stores report through the rollup listener. */
export function collectAccountUsage(
  options: { force?: boolean; only?: AccountUsageProvider } = {}
): Promise<void> {
  if (collecting && !options.only) {
    return collecting
  }
  const run = collectThroughBackend({ force: options.force ?? false, only: options.only })
    .then(() => {})
    .catch((error) => console.warn('[account-usage] Collection failed:', error))
  if (!options.only) {
    collecting = run.finally(() => {
      collecting = null
      lastCollectedAt = Date.now()
    })
    return collecting
  }
  return run
}

/**
 * Collects again when Orca is in use: after a usage scan or when a window regains focus, at most
 * once per gap. Why not a timer: an idle Orca has nothing new to credit. Scans the collection
 * itself starts land while it runs or within the gap, so they never chain another one.
 */
export function collectAccountUsageAfterActivity(): void {
  // lastCollectedAt 0: the startup collection has not run yet and owns the first one.
  if (
    !ledger ||
    collecting ||
    !lastCollectedAt ||
    Date.now() - lastCollectedAt < MIN_COLLECTION_GAP_MS
  ) {
    return
  }
  void collectAccountUsage()
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
  collect: BackendCollector
): AccountUsageLedger {
  collector = collect
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
      const state = await (await getAntigravityAccountService({ runtime: 'host' })).listAccounts()
      return {
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        currentEmail: state.currentAccount?.email ?? null
      }
    }
  })
  setBeforeAccountSwitchHook(collectAccountUsageBeforeSwitch)
  setTimeout(() => void collectAccountUsage(), FIRST_COLLECTION_DELAY_MS).unref()
  return ledger
}

export function getAccountUsageLedger(): AccountUsageLedger | null {
  return ledger
}
