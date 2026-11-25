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
  ACCOUNT_USAGE_WINDOWS,
  type AccountUsageWindow,
  type AccountUsageWindowsSnapshot
} from '../../shared/account-usage-windows-types'
import {
  collectAccountUsage,
  collectAccountUsageAfterActivity,
  getAccountUsageLedger,
  installAccountUsageLedger
} from './account-usage-collection'
// Fork: expose usage windows snapshot to runtime RPC without importing Electron in runtime (FORK.md §15).
import { setAccountUsageWindowsReader } from './account-usage-windows-bridge'
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
const HourlyBucketSchema = z.object({
  hour: z.string().max(32),
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
      buckets: z.array(BucketSchema),
      hourlyBuckets: z.array(HourlyBucketSchema).optional()
    })
  )
})
const WindowArgsSchema = z.object({ window: z.enum(ACCOUNT_USAGE_WINDOWS) })
const RemoveEntryArgsSchema = z.object({
  target: z.object({
    provider: z.enum(ACCOUNT_USAGE_PROVIDERS),
    accountKey: z.string().min(1).max(512),
    model: z.string().min(1).max(512).optional()
  }),
  window: z.enum(ACCOUNT_USAGE_WINDOWS)
})

type BackendControl = { callControl(method: string, params: unknown): Promise<unknown> }

function accountUsageSnapshot(
  range: AccountUsageLedgerRange
): Promise<AccountUsageLedgerSnapshot> | AccountUsageLedgerSnapshot {
  const ledger = getAccountUsageLedger()
  return ledger ? ledger.getSnapshot(range) : { range, rows: [], daily: [], updatedAt: null }
}

function emptyWindowsSnapshot(window: AccountUsageWindow): AccountUsageWindowsSnapshot {
  return {
    window,
    updatedAt: null,
    summaries: (['1h', '5h', '7d', 'all'] as const).map((entry) => ({
      window: entry,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      credits: 0,
      estimatedCostUsd: null,
      activity: 0,
      estimated: false
    })),
    rows: [],
    hourly: []
  }
}

function accountUsageWindowsSnapshot(
  window: AccountUsageWindow
): Promise<AccountUsageWindowsSnapshot> | AccountUsageWindowsSnapshot {
  const ledger = getAccountUsageLedger()
  return ledger ? ledger.getWindowsSnapshot(window) : emptyWindowsSnapshot(window)
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
  // Fork: usage windows ledger IPC + runtime RPC bridge (FORK.md §12, §15).
  setAccountUsageWindowsReader((window) => accountUsageWindowsSnapshot(window))
  ipcMain.handle('accountUsage:getWindowsSnapshot', (_event, rawArgs: unknown) => {
    const { window } = WindowArgsSchema.parse(rawArgs)
    return accountUsageWindowsSnapshot(window)
  })
  ipcMain.handle('accountUsage:refreshWindows', async (_event, rawArgs: unknown) => {
    const { window } = WindowArgsSchema.parse(rawArgs)
    await collectAccountUsage({ force: true })
    return accountUsageWindowsSnapshot(window)
  })
  ipcMain.handle('accountUsage:removeEntry', (_event, rawArgs: unknown) => {
    const { target, window } = RemoveEntryArgsSchema.parse(rawArgs)
    const ledger = getAccountUsageLedger()
    return ledger ? ledger.removeEntry(target, window) : emptyWindowsSnapshot(window)
  })
}
