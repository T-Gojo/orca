import type {
  AccountUsageBucket,
  AccountUsageLedgerRange,
  AccountUsageLedgerRow,
  AccountUsageProvider,
  UsageSourceRollup
} from '../../shared/account-usage-ledger-types'
import { UNATTRIBUTED_ACCOUNT_KEY } from '../../shared/account-usage-ledger-types'
import { addBuckets, bucketKey } from './usage-source-rollups'
import { getUsageRangeCutoff } from './usage-calendar-range'

type BucketMap = Record<string, AccountUsageBucket>

export type AccountUsageLedgerState = {
  version: 1
  updatedAt: number | null
  /** Highest totals seen per agent home folder; usage below them was already credited. */
  observed: Partial<Record<AccountUsageProvider, Record<string, BucketMap>>>
  accounts: Partial<
    Record<AccountUsageProvider, Record<string, { label: string | null; buckets: BucketMap }>>
  >
}

export type ResolvedSourceAccount = {
  accountKey: string
  label: string | null
  /** Several accounts write here over time, so history found on first sight has no owner. */
  shared: boolean
}

export function emptyAccountUsageLedger(): AccountUsageLedgerState {
  return { version: 1, updatedAt: null, observed: {}, accounts: {} }
}

const COUNTED_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheTokens',
  'reasoningTokens',
  'totalTokens',
  'activity'
] as const

function growth(current: AccountUsageBucket, seen: AccountUsageBucket | undefined) {
  const delta: AccountUsageBucket = { ...current }
  const highest: AccountUsageBucket = { ...current }
  for (const field of COUNTED_FIELDS) {
    const before = seen?.[field] ?? 0
    delta[field] = Math.max(current[field] - before, 0)
    highest[field] = Math.max(current[field], before)
  }
  const beforeCost = seen?.costUsd ?? null
  delta.costUsd = current.costUsd === null ? null : Math.max(current.costUsd - (beforeCost ?? 0), 0)
  highest.costUsd =
    current.costUsd === null && beforeCost === null
      ? null
      : Math.max(current.costUsd ?? 0, beforeCost ?? 0)
  return { delta, highest, grew: delta.totalTokens > 0 || delta.activity > 0 }
}

/**
 * Credit only what each folder gained since the last scan. Why: deleted transcripts (a removed
 * account's folder) then leave already-recorded usage in place instead of shrinking it.
 */
export function recordSourceRollups(
  state: AccountUsageLedgerState,
  provider: AccountUsageProvider,
  rollups: readonly UsageSourceRollup[],
  resolve: (home: string) => ResolvedSourceAccount,
  now: number
): AccountUsageLedgerState {
  const observed = { ...state.observed[provider] }
  const accounts = { ...state.accounts[provider] }
  for (const rollup of rollups) {
    const firstSight = !(rollup.home in observed)
    const owner = resolve(rollup.home)
    const accountKey = firstSight && owner.shared ? UNATTRIBUTED_ACCOUNT_KEY : owner.accountKey
    const seen = { ...observed[rollup.home] }
    const account = accounts[accountKey] ?? { label: null, buckets: {} }
    const buckets = { ...account.buckets }
    for (const bucket of rollup.buckets) {
      const key = bucketKey(bucket)
      const { delta, highest, grew } = growth(bucket, seen[key])
      seen[key] = highest
      if (grew) {
        buckets[key] = buckets[key] ? addBuckets(buckets[key], delta) : delta
      }
    }
    observed[rollup.home] = seen
    accounts[accountKey] = {
      label: accountKey === UNATTRIBUTED_ACCOUNT_KEY ? null : (owner.label ?? account.label),
      buckets
    }
  }
  return {
    ...state,
    updatedAt: now,
    observed: { ...state.observed, [provider]: observed },
    accounts: { ...state.accounts, [provider]: accounts }
  }
}

export function summarizeAccountUsageLedger(
  state: AccountUsageLedgerState,
  range: AccountUsageLedgerRange,
  isSaved: (provider: AccountUsageProvider, accountKey: string) => boolean
): AccountUsageLedgerRow[] {
  const cutoff = getUsageRangeCutoff(range)
  const rows: AccountUsageLedgerRow[] = []
  for (const provider of ['claude', 'codex'] as const) {
    for (const [accountKey, account] of Object.entries(state.accounts[provider] ?? {})) {
      const row: AccountUsageLedgerRow = {
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
        estimatedCostUsd: null,
        activeDays: 0,
        lastActiveDay: null,
        topModel: null
      }
      const days = new Set<string>()
      const byModel = new Map<string, number>()
      for (const bucket of Object.values(account.buckets)) {
        if (cutoff && bucket.day < cutoff) {
          continue
        }
        for (const field of COUNTED_FIELDS) {
          row[field] += bucket[field]
        }
        if (bucket.costUsd !== null) {
          row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + bucket.costUsd
        }
        days.add(bucket.day)
        if (!row.lastActiveDay || bucket.day > row.lastActiveDay) {
          row.lastActiveDay = bucket.day
        }
        const model = bucket.model ?? 'unknown'
        byModel.set(model, (byModel.get(model) ?? 0) + bucket.totalTokens)
      }
      row.activeDays = days.size
      row.topModel = [...byModel].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
      if (row.totalTokens > 0 || row.activity > 0) {
        rows.push(row)
      }
    }
  }
  return rows.sort((left, right) => right.totalTokens - left.totalTokens)
}
