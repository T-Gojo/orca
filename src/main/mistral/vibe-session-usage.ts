import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import { getLocalUsageDay } from '../usage/reporting/range-query/usage-calendar-range'
import { toUtcHourKey } from '../usage/account-usage-hourly-model'
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

/** One session's usage split chronologically into day and UTC-hour deltas across journal segments. */
function rollupOfSession(dir: string, sessionId: string): UsageSourceRollup[] {
  let segments: string[]
  try {
    segments = readdirSync(join(dir, 'journal')).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  const model = modelOfSession(dir)
  const session = accountBucketOfSession(dir)
  const builder = new SourceRollupBuilder()
  const high = { cached: 0, input: 0, output: 0 }
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
      if (!usage || usage.updatedAt <= 0) {
        continue
      }
      const day = getLocalUsageDay(new Date(usage.updatedAt).toISOString())
      const hour = toUtcHourKey(usage.updatedAt)
      if (!day || !hour) {
        continue
      }
      const dCached = Math.max(usage.cached - high.cached, 0)
      const dInput = Math.max(usage.input - high.input, 0)
      const dOutput = Math.max(usage.output - high.output, 0)
      high.cached = Math.max(high.cached, usage.cached)
      high.input = Math.max(high.input, usage.input)
      high.output = Math.max(high.output, usage.output)
      // Why the split: mistral-vibe's inputTokens include cached tokens, and totalTokens leave them out.
      const cacheTokens = Math.min(dCached, dInput)
      const inputTokens = dInput - cacheTokens
      const totalTokens = inputTokens + dOutput + cacheTokens
      if (totalTokens <= 0) {
        continue
      }
      builder.add(
        { source: sessionId, home: null, session },
        {
          day,
          model,
          inputTokens,
          outputTokens: dOutput,
          cacheTokens,
          reasoningTokens: 0,
          totalTokens,
          activity: 1,
          credits: 0,
          costUsd: null
        },
        hour
      )
    }
  }
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
