import type {
  AccountUsageBucket,
  AccountUsageProvider
} from '../../shared/account-usage-ledger-types'
import { ACCOUNT_USAGE_PROVIDERS } from '../../shared/account-usage-ledger-types'
import type {
  AccountUsageHourlyBucket,
  AccountUsageHourlyPoint,
  AccountUsageModelBreakdown,
  AccountUsageWindow,
  AccountUsageWindowRow,
  AccountUsageWindowsSnapshot,
  AccountUsageWindowSummary
} from '../../shared/account-usage-windows-types'
import type { AccountUsageLedgerState } from './account-usage-ledger-model'
import { getHourlyWindowCutoff } from './account-usage-hourly-model'
import { formatLocalDay } from './reporting/range-query/usage-calendar-range'

// Fork: summarizes account usage windows (1h/5h/7d/30d/90d/all) and per-model breakdowns (FORK.md §12).

const COUNTED_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheTokens',
  'reasoningTokens',
  'totalTokens',
  'activity',
  'credits'
] as const

const SUMMARY_WINDOWS = ['1h', '5h', '7d', 'all'] as const

type CountedBucket = Pick<
  AccountUsageBucket,
  | 'model'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheTokens'
  | 'reasoningTokens'
  | 'totalTokens'
  | 'activity'
  | 'credits'
  | 'costUsd'
  | 'estimated'
>

function getDayWindowCutoff(window: '7d' | '30d' | '90d' | 'all', nowMs: number): string | null {
  if (window === 'all') {
    return null
  }
  const days = window === '7d' ? 7 : window === '30d' ? 30 : 90
  const cutoff = new Date(nowMs)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return formatLocalDay(cutoff)
}

function selectAccountBuckets(
  account: {
    buckets: Record<string, AccountUsageBucket>
    hourly?: Record<string, AccountUsageHourlyBucket>
  },
  window: AccountUsageWindow,
  nowMs: number
): { bucket: CountedBucket; stamp: string }[] {
  if (window === '1h' || window === '5h') {
    const cutoff = getHourlyWindowCutoff(window, nowMs)
    const selected: { bucket: CountedBucket; stamp: string }[] = []
    for (const bucket of Object.values(account.hourly ?? {})) {
      if (!cutoff || bucket.hour >= cutoff) {
        selected.push({ bucket, stamp: bucket.hour })
      }
    }
    return selected
  }
  const cutoff = getDayWindowCutoff(window, nowMs)
  const selected: { bucket: CountedBucket; stamp: string }[] = []
  for (const bucket of Object.values(account.buckets)) {
    if (!cutoff || bucket.day >= cutoff) {
      selected.push({ bucket, stamp: bucket.day })
    }
  }
  return selected
}

function addCountedTotals(
  target: Record<(typeof COUNTED_FIELDS)[number], number> & {
    estimatedCostUsd: number | null
    estimated: boolean
  },
  bucket: CountedBucket
): void {
  for (const field of COUNTED_FIELDS) {
    target[field] += bucket[field] ?? 0
  }
  if (bucket.costUsd !== null) {
    target.estimatedCostUsd = (target.estimatedCostUsd ?? 0) + bucket.costUsd
  }
  target.estimated ||= bucket.estimated === true
}

function summarizeHeadline(
  state: AccountUsageLedgerState,
  window: '1h' | '5h' | '7d' | 'all',
  nowMs: number
): AccountUsageWindowSummary {
  const summary: AccountUsageWindowSummary = {
    window,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    credits: 0,
    estimatedCostUsd: null,
    activity: 0,
    estimated: false
  }
  for (const provider of ACCOUNT_USAGE_PROVIDERS) {
    for (const account of Object.values(state.providers[provider]?.accounts ?? {})) {
      for (const { bucket } of selectAccountBuckets(account, window, nowMs)) {
        addCountedTotals(summary, bucket)
      }
    }
  }
  return summary
}

function summarizeHourlyPoints(
  state: AccountUsageLedgerState,
  window: AccountUsageWindow,
  nowMs: number
): AccountUsageHourlyPoint[] {
  const cutoff = getHourlyWindowCutoff(window, nowMs)
  const byKey = new Map<string, AccountUsageHourlyPoint>()
  for (const provider of ACCOUNT_USAGE_PROVIDERS) {
    for (const account of Object.values(state.providers[provider]?.accounts ?? {})) {
      for (const bucket of Object.values(account.hourly ?? {})) {
        if (cutoff && bucket.hour < cutoff) {
          continue
        }
        const key = `${provider}::${bucket.hour}`
        const point = byKey.get(key) ?? {
          hour: bucket.hour,
          provider,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          credits: 0,
          activity: 0,
          estimated: false
        }
        for (const field of COUNTED_FIELDS) {
          point[field] += bucket[field] ?? 0
        }
        point.estimated ||= bucket.estimated === true
        byKey.set(key, point)
      }
    }
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.hour.localeCompare(right.hour) || left.provider.localeCompare(right.provider)
  )
}

export function summarizeAccountUsageWindows(
  state: AccountUsageLedgerState,
  window: AccountUsageWindow,
  isSaved: (provider: AccountUsageProvider, accountKey: string) => boolean,
  nowMs: number = Date.now()
): AccountUsageWindowsSnapshot {
  const rows: AccountUsageWindowRow[] = []
  for (const provider of ACCOUNT_USAGE_PROVIDERS) {
    for (const [accountKey, account] of Object.entries(state.providers[provider]?.accounts ?? {})) {
      const row: AccountUsageWindowRow = {
        provider,
        accountKey,
        label: account.label,
        removed: !isSaved(provider, accountKey),
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        activity: 0,
        credits: 0,
        sessions: account.sources.length,
        estimatedCostUsd: null,
        lastActiveAt: null,
        models: [],
        estimated: false
      }
      const modelsByName = new Map<string, AccountUsageModelBreakdown>()
      for (const { bucket, stamp } of selectAccountBuckets(account, window, nowMs)) {
        addCountedTotals(row, bucket)
        if (!row.lastActiveAt || stamp > row.lastActiveAt) {
          row.lastActiveAt = stamp
        }
        const modelName = bucket.model ?? 'unknown'
        const modelRow = modelsByName.get(modelName) ?? {
          model: modelName,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          activity: 0,
          credits: 0,
          estimatedCostUsd: null,
          estimated: false
        }
        addCountedTotals(modelRow, bucket)
        modelsByName.set(modelName, modelRow)
      }
      row.models = [...modelsByName.values()].sort(
        (left, right) =>
          right.totalTokens - left.totalTokens ||
          right.credits - left.credits ||
          left.model.localeCompare(right.model)
      )
      if (row.totalTokens > 0 || row.activity > 0 || row.credits > 0) {
        rows.push(row)
      }
    }
  }
  rows.sort((left, right) => right.totalTokens - left.totalTokens || right.credits - left.credits)
  return {
    window,
    updatedAt: state.updatedAt,
    summaries: SUMMARY_WINDOWS.map((entry) => summarizeHeadline(state, entry, nowMs)),
    rows,
    hourly: summarizeHourlyPoints(state, window, nowMs)
  }
}
