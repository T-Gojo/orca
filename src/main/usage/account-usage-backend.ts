import { z } from 'zod'
import {
  ACCOUNT_USAGE_PROVIDERS,
  type AccountSourceRollups,
  type AccountUsageProvider,
  type UsageSourceRollup
} from '../../shared/account-usage-ledger-types'
import {
  collectAccountSourcesViaWorker,
  setUsageSourceRollupListener
} from './scan-worker/usage-scan-worker-spawn'

// Fork: the usage backend's half of the account ledger (FORK.md section 5). Keep Electron-free.

type RefreshableUsageStore = {
  getScanState: () => { enabled: boolean }
  refresh: (force?: boolean) => Promise<unknown>
}

export type AccountUsageTokenStores = Record<'claude' | 'codex' | 'opencode', RefreshableUsageStore>

export type AccountUsageRecorder = (
  provider: AccountUsageProvider,
  rollups: UsageSourceRollup[]
) => Promise<unknown>

const CollectParams = z
  .object({ force: z.boolean().optional(), only: z.enum(ACCOUNT_USAGE_PROVIDERS).optional() })
  .strip()

/** Sends each scan's per-home totals to the ledger's owner; returns the undo for shutdown. */
export function forwardAccountUsageRollups(record: AccountUsageRecorder | undefined): () => void {
  if (!record) {
    return () => {}
  }
  setUsageSourceRollupListener(async (provider, rollups) => {
    await record(provider, rollups)
  })
  return () => setUsageSourceRollupListener(null)
}

/** Refreshes the token stores (their rollups go out through the listener) and reads kiro-cli/agy logs. */
export async function collectAccountUsageSources(
  stores: AccountUsageTokenStores,
  raw: unknown
): Promise<AccountSourceRollups> {
  const { force = false, only } = CollectParams.parse(raw ?? {})
  const wanted = (provider: AccountUsageProvider): boolean =>
    only === undefined || only === provider
  const [, sources] = await Promise.all([
    Promise.all(
      (['claude', 'codex', 'opencode'] as const)
        .filter(wanted)
        .map((provider) =>
          Promise.resolve(
            stores[provider].getScanState().enabled ? stores[provider].refresh(force) : null
          )
        )
    ),
    wanted('kiro') || wanted('antigravity')
      ? collectAccountSourcesViaWorker()
      : Promise.resolve({ kiro: [], antigravity: [] })
  ])
  return {
    kiro: wanted('kiro') ? sources.kiro : [],
    antigravity: wanted('antigravity') ? sources.antigravity : []
  }
}
