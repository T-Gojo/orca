import { basename, dirname, sep } from 'node:path'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'

type RolledFile<Aggregate> = { path: string; dailyAggregates: Aggregate[] }

export function bucketKey(bucket: Pick<AccountUsageBucket, 'day' | 'model'>): string {
  return `${bucket.day}::${bucket.model ?? ''}`
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
    credits: (left.credits ?? 0) + (right.credits ?? 0),
    costUsd: addCost(left.costUsd, right.costUsd),
    ...(left.estimated || right.estimated ? { estimated: true } : {})
  }
}

/** Merges rows that share a source and a day/model bucket. */
export class SourceRollupBuilder {
  private readonly bySource = new Map<
    string,
    { home: string | null; session: string | null; buckets: Map<string, AccountUsageBucket> }
  >()

  add(
    source: { source: string; home: string | null; session: string | null },
    bucket: AccountUsageBucket
  ): void {
    const entry = this.bySource.get(source.source) ?? {
      home: source.home,
      session: source.session,
      buckets: new Map<string, AccountUsageBucket>()
    }
    this.bySource.set(source.source, entry)
    const key = bucketKey(bucket)
    const existing = entry.buckets.get(key)
    entry.buckets.set(key, existing ? addBuckets(existing, bucket) : bucket)
  }

  build(): UsageSourceRollup[] {
    return [...this.bySource].map(([source, entry]) => ({
      source,
      home: entry.home,
      session: entry.session,
      buckets: [...entry.buckets.values()]
    }))
  }
}

function rootOf(path: string, roots: readonly string[]): string | null {
  // Longest root first so a nested root wins over its parent.
  return (
    [...roots]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => path.startsWith(candidate + sep)) ?? null
  )
}

/** Claude: one source per session, whichever alias folder (account home symlink) holds its log. */
export function claudeSessionRollups<Aggregate>(
  files: readonly RolledFile<Aggregate>[],
  roots: readonly string[],
  toBucket: (aggregate: Aggregate) => AccountUsageBucket
): UsageSourceRollup[] {
  const builder = new SourceRollupBuilder()
  for (const file of files) {
    const root = rootOf(file.path, roots)
    // Subagent logs live under <session>/subagents/, so their parent folder names the session.
    const parent = basename(dirname(file.path))
    const session =
      parent === 'subagents' ? basename(dirname(dirname(file.path))) : basename(file.path, '.jsonl')
    for (const aggregate of file.dailyAggregates) {
      builder.add(
        { source: session, home: root ? dirname(root) : null, session },
        toBucket(aggregate)
      )
    }
  }
  return builder.build()
}

/** Codex: one source per rollout log; its home folder names the account. */
export function codexFileRollups<Aggregate>(
  files: readonly RolledFile<Aggregate>[],
  roots: readonly string[],
  toBucket: (aggregate: Aggregate) => AccountUsageBucket
): UsageSourceRollup[] {
  const builder = new SourceRollupBuilder()
  for (const file of files) {
    const root = rootOf(file.path, roots)
    for (const aggregate of file.dailyAggregates) {
      builder.add(
        { source: file.path, home: root ? dirname(root) : null, session: null },
        toBucket(aggregate)
      )
    }
  }
  return builder.build()
}

/** OpenCode: one source per database and connector; the connector is the model's provider. */
export function openCodeConnectorRollups<Aggregate extends { model: string | null }>(
  databases: readonly RolledFile<Aggregate>[],
  toBucket: (aggregate: Aggregate) => AccountUsageBucket
): UsageSourceRollup[] {
  const builder = new SourceRollupBuilder()
  for (const database of databases) {
    for (const aggregate of database.dailyAggregates) {
      const connector = aggregate.model?.includes('/')
        ? aggregate.model.slice(0, aggregate.model.indexOf('/'))
        : 'opencode'
      builder.add(
        { source: `${database.path}::${connector}`, home: null, session: connector },
        toBucket(aggregate)
      )
    }
  }
  return builder.build()
}
