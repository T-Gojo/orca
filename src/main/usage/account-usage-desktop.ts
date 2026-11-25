import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  ACCOUNT_USAGE_COLLECT_METHOD,
  ACCOUNT_USAGE_PROVIDERS,
  type AccountSourceRollups,
  type AccountUsageLedgerRange,
  type AccountUsageLedgerSnapshot
} from '../../shared/account-usage-ledger-types'
import {
  collectAccountUsage,
  collectAccountUsageAfterActivity,
  getAccountUsageLedger,
  installAccountUsageLedger
} from './account-usage-collection'
import type { LedgerSettings } from './account-usage-source-owners'

// Fork: main's half of the account ledger (FORK.md section 5). The token stores and the scan
// worker run in upstream's usage backend; the ledger, settings and account vaults stay in main.

const BucketSchema = z.object({
  day: z.string().max(32),
  model: z.string().max(512).nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  activity: z.number(),
  credits: z.number(),
  costUsd: z.number().nullable(),
  estimated: z.boolean().optional()
})
const RecordParams = z.object({
  provider: z.enum(ACCOUNT_USAGE_PROVIDERS),
  rollups: z.array(
    z.object({
      source: z.string().max(4096),
      home: z.string().max(4096).nullable(),
      session: z.string().max(512).nullable(),
      buckets: z.array(BucketSchema)
    })
  )
})

type BackendControl = { callControl(method: string, params: unknown): Promise<unknown> }

function accountUsageSnapshot(
  range: AccountUsageLedgerRange
): Promise<AccountUsageLedgerSnapshot> | AccountUsageLedgerSnapshot {
  const ledger = getAccountUsageLedger()
  return ledger ? ledger.getSnapshot(range) : { range, rows: [], daily: [], updatedAt: null }
}

/** The usage backend's report of one scan's per-home totals. */
export async function recordAccountUsageFromBackend(raw: unknown): Promise<null> {
  const { provider, rollups } = RecordParams.parse(raw)
  await getAccountUsageLedger()?.record(provider, rollups)
  // A scan means Orca is in use; kiro-cli and agy logs have no scan of their own.
  collectAccountUsageAfterActivity()
  return null
}

export function installDesktopAccountUsage(
  store: { getSettings(): LedgerSettings },
  backend: BackendControl
): void {
  installAccountUsageLedger(
    () => store.getSettings(),
    async (request) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The private usage service returns collectAccountUsageSources' typed result for this method.
      (await backend.callControl(ACCOUNT_USAGE_COLLECT_METHOD, request)) as AccountSourceRollups
  )
  app.on('browser-window-focus', collectAccountUsageAfterActivity)
  ipcMain.handle('accountUsage:getSnapshot', (_event, args: { range: AccountUsageLedgerRange }) =>
    accountUsageSnapshot(args.range)
  )
  ipcMain.handle(
    'accountUsage:refresh',
    async (_event, args: { range: AccountUsageLedgerRange }) => {
      await collectAccountUsage({ force: true })
      return accountUsageSnapshot(args.range)
    }
  )
}
