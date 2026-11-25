import type { AccountUsageBucket } from '../../shared/account-usage-ledger-types'
import type {
  AccountUsageHourlyBucket,
  AccountUsageRemoveTarget,
  AccountUsageWindow
} from '../../shared/account-usage-windows-types'
import type { AccountUsageLedgerState } from './account-usage-ledger-model'

// Fork: hourly time-series ledger bucket arithmetic, delta recording, and manual removal (FORK.md §12).

const COUNTED_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheTokens',
  'reasoningTokens',
  'totalTokens',
  'activity',
  'credits'
] as const

const HOUR_MS = 3_600_000

/** Parses epoch ms or an ISO string into a UTC hour key ('YYYY-MM-DDTHH'). */
export function toUtcHourKey(input: number | string): string | null {
  if (typeof input === 'number' && (!Number.isFinite(input) || input <= 0)) {
    return null
  }
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 13)
}

export function hourlyBucketKey(bucket: Pick<AccountUsageHourlyBucket, 'hour' | 'model'>): string {
  return `${bucket.hour}::${bucket.model ?? ''}`
}

function addCost(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0)
}

export function addHourlyBuckets(
  left: AccountUsageHourlyBucket,
  right: AccountUsageHourlyBucket
): AccountUsageHourlyBucket {
  return {
    hour: left.hour,
    model: left.model,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheTokens: left.cacheTokens + right.cacheTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    activity: left.activity + right.activity,
    credits: (left.credits ?? 0) + (right.credits ?? 0),
    costUsd: addCost(left.costUsd, right.costUsd),
    ...(left.estimated || right.estimated ? { estimated: true } : {})
  }
}

export function hourlyBucketGrowth(
  current: AccountUsageHourlyBucket,
  seen: AccountUsageHourlyBucket | undefined
): { delta: AccountUsageHourlyBucket; highest: AccountUsageHourlyBucket; grew: boolean } {
  const delta: AccountUsageHourlyBucket = { ...current }
  const highest: AccountUsageHourlyBucket = {
    ...current,
    estimated: current.estimated ?? seen?.estimated
  }
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

export function mergeHourlyRollupBuckets(
  buckets: readonly AccountUsageHourlyBucket[]
): AccountUsageHourlyBucket[] {
  const merged = new Map<string, AccountUsageHourlyBucket>()
  for (const bucket of buckets) {
    const key = hourlyBucketKey(bucket)
    const existing = merged.get(key)
    merged.set(key, existing ? addHourlyBuckets(existing, bucket) : bucket)
  }
  return [...merged.values()]
}

/**
 * Inclusive UTC-hour cutoff for each window:
 * 1h = current UTC hour (1 bucket), 5h = last 5 buckets (now - 4h..now),
 * 7d = 168 buckets, 30d = 720 buckets, 90d = 2160 buckets, all = null.
 */
export function getHourlyWindowCutoff(window: AccountUsageWindow, nowMs: number): string | null {
  if (window === 'all') {
    return null
  }
  const hours =
    window === '1h'
      ? 1
      : window === '5h'
        ? 5
        : window === '7d'
          ? 168
          : window === '30d'
            ? 720
            : 2160
  return toUtcHourKey(nowMs - (hours - 1) * HOUR_MS)
}

/** Records hourly deltas for one source into copies of account.hourly and source.seenHourly. */
export function recordHourlyForSource(
  accountHourly: Record<string, AccountUsageHourlyBucket>,
  seenHourly: Record<string, AccountUsageHourlyBucket>,
  rollupHourly: readonly AccountUsageHourlyBucket[] | undefined,
  dayDeltas: readonly AccountUsageBucket[],
  baseline: boolean,
  now: number
): boolean {
  let credited = false
  if (rollupHourly && rollupHourly.length > 0) {
    for (const bucket of mergeHourlyRollupBuckets(rollupHourly)) {
      const key = hourlyBucketKey(bucket)
      const { delta, highest, grew } = hourlyBucketGrowth(bucket, seenHourly[key])
      seenHourly[key] = highest
      if (grew) {
        accountHourly[key] = accountHourly[key]
          ? addHourlyBuckets(accountHourly[key], delta)
          : delta
        credited = true
      }
    }
    return credited
  }
  // Why skip baseline: historical daily logs have no hourly stamps and must not spike 1h.
  if (baseline || dayDeltas.length === 0) {
    return false
  }
  const hour = toUtcHourKey(now)
  if (!hour) {
    return false
  }
  for (const dayDelta of dayDeltas) {
    const hourlyDelta: AccountUsageHourlyBucket = {
      hour,
      model: dayDelta.model,
      inputTokens: dayDelta.inputTokens,
      outputTokens: dayDelta.outputTokens,
      cacheTokens: dayDelta.cacheTokens,
      reasoningTokens: dayDelta.reasoningTokens,
      totalTokens: dayDelta.totalTokens,
      activity: dayDelta.activity,
      credits: dayDelta.credits ?? 0,
      costUsd: dayDelta.costUsd,
      ...(dayDelta.estimated ? { estimated: true } : {})
    }
    const key = hourlyBucketKey(hourlyDelta)
    accountHourly[key] = accountHourly[key]
      ? addHourlyBuckets(accountHourly[key], hourlyDelta)
      : hourlyDelta
    credited = true
  }
  return credited
}

/**
 * Deletes an account or one model's stored totals while leaving `sources` high-water marks intact
 * so existing logs on disk do not re-credit removed history on subsequent refreshes.
 */
export function removeAccountUsageEntry(
  state: AccountUsageLedgerState,
  target: AccountUsageRemoveTarget,
  nowMs: number = Date.now()
): AccountUsageLedgerState {
  const providerLedger = state.providers[target.provider]
  const account = providerLedger?.accounts[target.accountKey]
  if (!providerLedger || !account) {
    return state
  }
  const accounts = { ...providerLedger.accounts }
  if (target.model === undefined) {
    delete accounts[target.accountKey]
  } else {
    const matchesModel = (model: string | null): boolean =>
      target.model === 'unknown' ? model === null || model === 'unknown' : model === target.model
    const nextBuckets: Record<string, AccountUsageBucket> = {}
    for (const [key, bucket] of Object.entries(account.buckets)) {
      if (!matchesModel(bucket.model)) {
        nextBuckets[key] = bucket
      }
    }
    const nextHourly: Record<string, AccountUsageHourlyBucket> = {}
    for (const [key, bucket] of Object.entries(account.hourly ?? {})) {
      if (!matchesModel(bucket.model)) {
        nextHourly[key] = bucket
      }
    }
    if (Object.keys(nextBuckets).length === 0 && Object.keys(nextHourly).length === 0) {
      delete accounts[target.accountKey]
    } else {
      accounts[target.accountKey] = {
        label: account.label,
        buckets: nextBuckets,
        sources: account.sources,
        ...(Object.keys(nextHourly).length > 0 ? { hourly: nextHourly } : {})
      }
    }
  }
  return {
    ...state,
    updatedAt: nowMs,
    providers: {
      ...state.providers,
      [target.provider]: { sources: providerLedger.sources, accounts }
    }
  }
}
