import { dirname, sep } from 'node:path'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'

type RolledFile<Aggregate> = { path: string; dailyAggregates: Aggregate[] }

export function bucketKey(bucket: Pick<AccountUsageBucket, 'day' | 'model'>): string {
  return `${bucket.day}::${bucket.model ?? ''}`
}

/** Totals per agent home folder, so main can attribute each folder's usage to an account. */
export function rollupUsageBySourceHome<Aggregate>(
  files: readonly RolledFile<Aggregate>[],
  roots: readonly string[],
  toBucket: (aggregate: Aggregate) => AccountUsageBucket
): UsageSourceRollup[] {
  // Longest root first so a nested root wins over its parent.
  const ordered = [...new Set(roots)].sort((left, right) => right.length - left.length)
  const byHome = new Map<string, Map<string, AccountUsageBucket>>()
  for (const file of files) {
    const root = ordered.find((candidate) => file.path.startsWith(candidate + sep))
    if (!root) {
      continue
    }
    const home = dirname(root)
    const buckets = byHome.get(home) ?? new Map<string, AccountUsageBucket>()
    byHome.set(home, buckets)
    for (const aggregate of file.dailyAggregates) {
      const next = toBucket(aggregate)
      const key = bucketKey(next)
      const existing = buckets.get(key)
      buckets.set(key, existing ? addBuckets(existing, next) : next)
    }
  }
  return [...byHome].map(([home, buckets]) => ({ home, buckets: [...buckets.values()] }))
}

function addCost(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0)
}

export function addBuckets(
  left: AccountUsageBucket,
  right: AccountUsageBucket
): AccountUsageBucket {
  return {
    day: left.day,
    model: left.model,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheTokens: left.cacheTokens + right.cacheTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    activity: left.activity + right.activity,
    costUsd: addCost(left.costUsd, right.costUsd)
  }
}
