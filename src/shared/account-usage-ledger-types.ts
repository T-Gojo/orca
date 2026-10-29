export const ACCOUNT_USAGE_PROVIDERS = [
  'claude',
  'codex',
  'antigravity',
  'kiro',
  'opencode'
] as const

export type AccountUsageProvider = (typeof ACCOUNT_USAGE_PROVIDERS)[number]

/** Totals for one day and model; the unit both collectors and the ledger count in. */
export type AccountUsageBucket = {
  day: string
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  /** Turns, events or requests, whichever the agent records. */
  activity: number
  /** Plan credits spent (Kiro); 0 for agents that bill in tokens. */
  credits: number
  costUsd: number | null
  /** Token counts are Orca's estimate because the agent logs none (Kiro). */
  estimated?: boolean
}

/** What one session (or other append-only log) has used so far. */
export type UsageSourceRollup = {
  /** Stable id of the session or log; usage is counted per source, never twice. */
  source: string
  /** Agent home folder the log lives in, when that names the account. */
  home: string | null
  /** The agent's own session id, used to find which account ran it. */
  session: string | null
  buckets: AccountUsageBucket[]
}

/** Usage that was already logged when Orca started tracking, with no way to tell whose it was. */
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
  credits: number
  sessions: number
  estimatedCostUsd: number | null
  activeDays: number
  lastActiveDay: string | null
  topModel: string | null
  /** Some of the token counts are estimates. */
  estimated: boolean
}

/** One agent's usage on one day, summed over its accounts. */
export type AccountUsageDailyPoint = {
  day: string
  provider: AccountUsageProvider
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  credits: number
  activity: number
  estimated: boolean
}

export type AccountUsageLedgerRange = '7d' | '30d' | '90d' | 'all'

export type AccountUsageLedgerSnapshot = {
  range: AccountUsageLedgerRange
  rows: AccountUsageLedgerRow[]
  daily: AccountUsageDailyPoint[]
  /** Unix ms of the last collection the ledger recorded, null before the first. */
  updatedAt: number | null
}
