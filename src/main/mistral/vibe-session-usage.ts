import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import { getLocalUsageDay } from '../usage/reporting/range-query/usage-calendar-range'
import { SourceRollupBuilder } from '../usage/usage-source-rollups'

// Tokens each Mistral Vibe session used, from the session journals mistral-vibe writes
// under $VIBE_HOME/logs/session/unified/<id>/journal/*.jsonl. Those journals carry cumulative
// session counters, so a session's total is the highest counter any record shows — unlike
// kiro-cli's logs nothing here is estimated.

type MeteredUsage = {
  cached: number
  input: number
  output: number
  total: number
  /** ms-epoch write time on the session state this record projected. */
  updatedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

/** The cumulative session counters, when this projection_delta carried them. */
function tokenUsageOf(record: unknown): MeteredUsage | null {
  if (!isRecord(record) || record.type !== 'projection_delta' || !isRecord(record.payload)) {
    return null
  }
  const delta = Array.isArray(record.payload.delta) ? record.payload.delta : []
  for (const entry of delta) {
    const state = isRecord(entry) && isRecord(entry.state) ? entry.state : null
    const session = state && isRecord(state.session) ? state.session : null
    if (!session || !isRecord(session.tokenUsage)) {
      continue
    }
    return {
      cached: numberOf(session.tokenUsage.cachedInputTokens),
      input: numberOf(session.tokenUsage.inputTokens),
      output: numberOf(session.tokenUsage.outputTokens),
      total: numberOf(session.tokenUsage.totalTokens),
      updatedAt: numberOf(session.updatedAt)
    }
  }
  return null
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** meta.json's model, the one the session ran (mistral-vibe writes it at config.active_model). */
function modelOfSession(dir: string): string | null {
  const meta = readJson(join(dir, 'meta.json'))
  const config = isRecord(meta) && isRecord(meta.config) ? meta.config : null
  const model = typeof config?.active_model === 'string' ? config.active_model : null
  const named = typeof config?.model_name === 'string' ? config.model_name : null
  return model || named || null
}

/** owner.json names who ran the session; the ledger matches it to a saved account. */
function accountBucketOfSession(dir: string): string {
  const owner = readJson(join(dir, 'owner.json'))
  const account = isRecord(owner) && isRecord(owner.account) ? owner.account : null
  const organizationId = typeof account?.organizationId === 'string' ? account.organizationId : ''
  const userId = typeof account?.userId === 'string' ? account.userId : ''
  return organizationId && userId ? `${organizationId}+${userId}` : ''
}

const cache = new Map<string, { stamp: string; rollups: UsageSourceRollup[] }>()

function stampOf(paths: readonly string[]): string {
  return paths.map((path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0).join(':')
}

/** Token counters of one session: the highest any journal segment shows, plus how many writes were metered. */
function usageOfSession(dir: string): { usage: MeteredUsage; activity: number } | null {
  let segments: string[]
  try {
    segments = readdirSync(join(dir, 'journal')).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return null
  }
  let highest: MeteredUsage | null = null
  let activity = 0
  for (const segment of segments.sort()) {
    const text = readFileSync(join(dir, 'journal', segment), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.includes('tokenUsage')) {
        continue
      }
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        // A line mistral-vibe is still writing.
        continue
      }
      const usage = tokenUsageOf(record)
      if (!usage) {
        continue
      }
      activity += 1
      if (!highest || usage.total > highest.total) {
        highest = usage
      }
    }
  }
  return highest ? { usage: highest, activity } : null
}

/** One session's usage as a single source rollup, built like kiro-cli's session rollups. */
function rollupOfSession(dir: string, sessionId: string): UsageSourceRollup[] {
  const metered = usageOfSession(dir)
  if (!metered || metered.usage.updatedAt <= 0) {
    return []
  }
  const day = getLocalUsageDay(new Date(metered.usage.updatedAt).toISOString())
  if (!day) {
    return []
  }
  const model = modelOfSession(dir)
  const builder = new SourceRollupBuilder()
  const cacheTokens = Math.min(metered.usage.cached, metered.usage.input)
  // Why the split: mistral-vibe's inputTokens include the cached ones, and its totalTokens leave
  // them out, so non-cached input + output + cache is both totals.
  builder.add(
    { source: sessionId, home: null, session: accountBucketOfSession(dir) },
    {
      day,
      model,
      inputTokens: metered.usage.input - cacheTokens,
      outputTokens: metered.usage.output,
      cacheTokens,
      reasoningTokens: 0,
      totalTokens: metered.usage.input - cacheTokens + metered.usage.output + cacheTokens,
      activity: metered.activity,
      credits: 0,
      costUsd: null
    }
  )
  return builder.build()
}

/** Token usage of every Mistral Vibe session; counters are real, so nothing is marked estimated. */
export function collectMistralVibeUsage(
  vibeHome: string = process.env.VIBE_HOME ?? join(homedir(), '.vibe')
): UsageSourceRollup[] {
  const sessionsRoot = join(vibeHome, 'logs', 'session', 'unified')
  let names: string[]
  try {
    names = readdirSync(sessionsRoot)
  } catch {
    return []
  }
  const rollups: UsageSourceRollup[] = []
  for (const name of names) {
    const dir = join(sessionsRoot, name)
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      continue
    }
    const stamp = stampOf([join(dir, 'meta.json'), join(dir, 'owner.json'), join(dir, 'journal')])
    const cached = cache.get(dir)
    if (cached && cached.stamp === stamp) {
      rollups.push(...cached.rollups)
      continue
    }
    const built = rollupOfSession(dir, name)
    cache.set(dir, { stamp, rollups: built })
    rollups.push(...built)
  }
  return rollups
}
