import type {
  AccountUsageBucket,
  AccountUsageLedgerRange,
  AccountUsageLedgerRow,
  AccountUsageProvider,
  UsageSourceRollup
} from '../../shared/account-usage-ledger-types'
import {
  ACCOUNT_USAGE_PROVIDERS,
  UNATTRIBUTED_ACCOUNT_KEY
} from '../../shared/account-usage-ledger-types'
import { addBuckets, bucketKey } from './usage-source-rollups'
import { getUsageRangeCutoff } from './usage-calendar-range'

type BucketMap = Record<string, AccountUsageBucket>

type LedgerSource = {
  /** Account the source's latest growth was credited to. */
  owner: string
  /** Highest totals seen; anything at or below them was already credited. */
  seen: BucketMap
}

type LedgerAccount = { label: string | null; buckets: BucketMap; sources: string[] }

type ProviderLedger = {
  sources: Record<string, LedgerSource>
  accounts: Record<string, LedgerAccount>
}

export type AccountUsageLedgerState = {
  version: 2
  updatedAt: number | null
  providers: Partial<Record<AccountUsageProvider, ProviderLedger>>
}

/**
 * Who used a source. `certain` answers come from the source itself (its folder or a live session
 * record); the rest are a best guess, such as the account signed in when the source first appeared.
 */
export type ResolvedSourceAccount = {
  accountKey: string
  label: string | null
  certain: boolean
}

export function emptyAccountUsageLedger(): AccountUsageLedgerState {
  return { version: 2, updatedAt: null, providers: {} }
}

const COUNTED_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheTokens',
  'reasoningTokens',
  'totalTokens',
  'activity',
  'credits'
] as const

function growth(current: AccountUsageBucket, seen: AccountUsageBucket | undefined) {
  const delta: AccountUsageBucket = { ...current }
  const highest: AccountUsageBucket = { ...current }
  let grew = false
  for (const field of COUNTED_FIELDS) {
    const before = seen?.[field] ?? 0
    const now = current[field] ?? 0
    delta[field] = Math.max(now - before, 0)
    highest[field] = Math.max(now, before)
    grew ||= delta[field] > 0
  }
  const beforeCost = seen?.costUsd ?? null
  delta.costUsd = current.costUsd === null ? null : Math.max(current.costUsd - (beforeCost ?? 0), 0)
  highest.costUsd =
    current.costUsd === null && beforeCost === null
      ? null
      : Math.max(current.costUsd ?? 0, beforeCost ?? 0)
  return { delta, highest, grew }
}

function chooseOwner(
  previous: LedgerSource | undefined,
  resolved: ResolvedSourceAccount,
  baseline: boolean
): string {
  if (resolved.certain) {
    return resolved.accountKey
  }
  if (previous) {
    // Why sticky: a guess made while the session ran beats a later guess about another account.
    return previous.owner
  }
  return baseline ? UNATTRIBUTED_ACCOUNT_KEY : resolved.accountKey
}

/**
 * Credit only what each source gained since the last collection. Why: deleted logs (a removed
 * account's folder) then leave recorded usage in place instead of shrinking it.
 */
export function recordSourceRollups(
  state: AccountUsageLedgerState,
  provider: AccountUsageProvider,
  rollups: readonly UsageSourceRollup[],
  resolve: (rollup: UsageSourceRollup) => ResolvedSourceAccount,
  now: number
): AccountUsageLedgerState {
  const previous = state.providers[provider]
  // The first collection meets history logged before Orca tracked who was signed in.
  const baseline = !previous || Object.keys(previous.sources).length === 0
  const sources = { ...previous?.sources }
  const accounts = { ...previous?.accounts }
  for (const rollup of rollups) {
    const prior = sources[rollup.source]
    const resolved = resolve(rollup)
    const owner = chooseOwner(prior, resolved, baseline)
    const seen = { ...prior?.seen }
    const existing = accounts[owner]
    const account: LedgerAccount = {
      label: existing?.label ?? null,
      buckets: { ...existing?.buckets },
      sources: existing?.sources ?? []
    }
    let credited = false
    for (const bucket of rollup.buckets) {
      const key = bucketKey(bucket)
      const { delta, highest, grew } = growth(bucket, seen[key])
      seen[key] = highest
      if (grew) {
        account.buckets[key] = account.buckets[key]
          ? addBuckets(account.buckets[key], delta)
          : delta
        credited = true
      }
    }
    sources[rollup.source] = { owner, seen }
    if (credited || existing) {
      if (owner !== UNATTRIBUTED_ACCOUNT_KEY && owner === resolved.accountKey) {
        account.label = resolved.label ?? account.label
      }
      if (credited && !account.sources.includes(rollup.source)) {
        account.sources = [...account.sources, rollup.source]
      }
      accounts[owner] = account
    }
  }
  return {
    ...state,
    updatedAt: now,
    providers: { ...state.providers, [provider]: { sources, accounts } }
  }
}

export function summarizeAccountUsageLedger(
  state: AccountUsageLedgerState,
  range: AccountUsageLedgerRange,
  isSaved: (provider: AccountUsageProvider, accountKey: string) => boolean
): AccountUsageLedgerRow[] {
  const cutoff = getUsageRangeCutoff(range)
  const rows: AccountUsageLedgerRow[] = []
  for (const provider of ACCOUNT_USAGE_PROVIDERS) {
    for (const [accountKey, account] of Object.entries(state.providers[provider]?.accounts ?? {})) {
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
        credits: 0,
        sessions: account.sources.length,
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
          row[field] += bucket[field] ?? 0
        }
        if (bucket.costUsd !== null) {
          row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + bucket.costUsd
        }
        days.add(bucket.day)
        if (!row.lastActiveDay || bucket.day > row.lastActiveDay) {
          row.lastActiveDay = bucket.day
        }
        const model = bucket.model ?? 'unknown'
        byModel.set(model, (byModel.get(model) ?? 0) + bucket.totalTokens + bucket.credits)
      }
      row.activeDays = days.size
      row.topModel = [...byModel].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
      if (row.totalTokens > 0 || row.activity > 0 || row.credits > 0) {
        rows.push(row)
      }
    }
  }
  return rows.sort(
    (left, right) => right.totalTokens - left.totalTokens || right.credits - left.credits
  )
}
