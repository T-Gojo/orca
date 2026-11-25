import type { AccountUsageProvider } from './account-usage-ledger-types'

// Fork: Usage windows ledger types (FORK.md §12).

export const ACCOUNT_USAGE_WINDOWS = ['1h', '5h', '7d', '30d', '90d', 'all'] as const

export type AccountUsageWindow = (typeof ACCOUNT_USAGE_WINDOWS)[number]

/** Totals for one UTC hour ('YYYY-MM-DDTHH') and model. */
export type AccountUsageHourlyBucket = {
  hour: string
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  activity: number
  credits: number
  costUsd: number | null
  estimated?: boolean
}

export type AccountUsageModelBreakdown = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  activity: number
  credits: number
  estimatedCostUsd: number | null
  estimated: boolean
}

export type AccountUsageWindowRow = {
  provider: AccountUsageProvider
  accountKey: string
  label: string | null
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
  lastActiveAt: string | null
  models: AccountUsageModelBreakdown[]
  estimated: boolean
}

export type AccountUsageHourlyPoint = {
  hour: string
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

export type AccountUsageWindowSummary = {
  window: '1h' | '5h' | '7d' | 'all'
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalTokens: number
  credits: number
  estimatedCostUsd: number | null
  activity: number
  estimated: boolean
}

export type AccountUsageWindowsSnapshot = {
  window: AccountUsageWindow
  updatedAt: number | null
  summaries: AccountUsageWindowSummary[]
  rows: AccountUsageWindowRow[]
  hourly: AccountUsageHourlyPoint[]
}

export type AccountUsageRemoveTarget = {
  provider: AccountUsageProvider
  accountKey: string
  model?: string
}
