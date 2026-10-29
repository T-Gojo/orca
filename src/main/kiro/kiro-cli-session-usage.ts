import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import { getLocalUsageDay } from '../usage/usage-calendar-range'
import { SourceRollupBuilder } from '../usage/usage-source-rollups'

type TurnRecord = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function turnsOf(session: unknown): TurnRecord[] {
  if (!isRecord(session) || !isRecord(session.session_state)) {
    return []
  }
  const metadata = session.session_state.conversation_metadata
  const turns = isRecord(metadata) ? metadata.user_turn_metadatas : null
  return Array.isArray(turns) ? turns.filter(isRecord) : []
}

/** kiro-cli bills in credits and records them per request; token counts may stay zero. */
function turnBucket(turn: TurnRecord): AccountUsageBucket | null {
  const ended = typeof turn.end_timestamp === 'string' ? turn.end_timestamp : null
  const day = ended ? getLocalUsageDay(ended) : null
  if (!day) {
    return null
  }
  const metering = Array.isArray(turn.metering_usage) ? turn.metering_usage : []
  const credits = metering
    .filter(isRecord)
    .filter((entry) => entry.unit === 'credit')
    .reduce((sum, entry) => sum + numberOf(entry.value), 0)
  const input = numberOf(turn.input_token_count)
  const output = numberOf(turn.output_token_count)
  const cache =
    numberOf(turn.cache_read_input_token_count) + numberOf(turn.cache_write_input_token_count)
  return {
    day,
    model: typeof turn.model === 'string' ? turn.model : null,
    inputTokens: input,
    outputTokens: output,
    cacheTokens: cache,
    reasoningTokens: 0,
    totalTokens: input + output + cache,
    activity: Math.max(numberOf(turn.total_request_count), 1),
    credits,
    costUsd: null
  }
}

const cache = new Map<string, { mtimeMs: number; rollups: UsageSourceRollup[] }>()

/** Credits and requests from every kiro-cli chat session; unchanged files reuse their last read. */
export function collectKiroCliUsage(kiroHome = join(homedir(), '.kiro')): UsageSourceRollup[] {
  const dir = join(kiroHome, 'sessions', 'cli')
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const rollups: UsageSourceRollup[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const mtimeMs = statSync(path).mtimeMs
      const cached = cache.get(path)
      if (cached && cached.mtimeMs === mtimeMs) {
        rollups.push(...cached.rollups)
        continue
      }
      const session: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const sessionId =
        isRecord(session) && typeof session.session_id === 'string'
          ? session.session_id
          : name.replace(/\.json$/, '')
      const builder = new SourceRollupBuilder()
      for (const turn of turnsOf(session)) {
        const bucket = turnBucket(turn)
        if (bucket) {
          builder.add({ source: sessionId, home: null, session: sessionId }, bucket)
        }
      }
      const read = builder.build()
      cache.set(path, { mtimeMs, rollups: read })
      rollups.push(...read)
    } catch {
      // kiro-cli may be mid-write; the next collection reads it whole.
    }
  }
  return rollups
}
