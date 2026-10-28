export type AccountUsageProvider = 'claude' | 'codex'

/** Token totals for one day and model; the unit both scans and the ledger count in. */
export type AccountUsageBucket = {
  day: string
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  activity: number
  costUsd: number | null
}

/** Totals a scan observed under one agent home folder (an account's, or a shared one). */
export type UsageSourceRollup = {
  home: string
  buckets: AccountUsageBucket[]
}

/** Accounts first seen in a shared folder: usage logged before Orca tracked who was signed in. */
export const UNATTRIBUTED_ACCOUNT_KEY = 'unattributed'
export const SYSTEM_DEFAULT_ACCOUNT_KEY = 'system-default'

export type AccountUsageLedgerRow = {
  provider: AccountUsageProvider
  accountKey: string
  label: string | null
  /** The account is no longer saved in Orca; its recorded usage is kept. */
  removed: boolean
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  activity: number
  estimatedCostUsd: number | null
  activeDays: number
  lastActiveDay: string | null
  topModel: string | null
}

export type AccountUsageLedgerRange = '7d' | '30d' | '90d' | 'all'

export type AccountUsageLedgerSnapshot = {
  range: AccountUsageLedgerRange
  rows: AccountUsageLedgerRow[]
  /** Unix ms of the last scan the ledger recorded, null before the first. */
  updatedAt: number | null
}
