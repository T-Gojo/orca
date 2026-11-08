import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import { getLocalUsageDay } from '../usage/usage-calendar-range'
import { SourceRollupBuilder } from '../usage/usage-source-rollups'

type TurnRecord = Record<string, unknown>

// Matches the context window kiro-cli reports for its Claude models when a session omits it.
const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000
// Common rule of thumb for English text and code: about four characters per token.
const CHARS_PER_TOKEN = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function sessionState(session: unknown): Record<string, unknown> | null {
  return isRecord(session) && isRecord(session.session_state) ? session.session_state : null
}

function turnsOf(session: unknown): TurnRecord[] {
  const metadata = sessionState(session)?.conversation_metadata
  const turns = isRecord(metadata) ? metadata.user_turn_metadatas : null
  return Array.isArray(turns) ? turns.filter(isRecord) : []
}

function contextWindowOf(session: unknown): number {
  const model = sessionState(session)?.rts_model_state
  const info = isRecord(model) && isRecord(model.model_info) ? model.model_info : null
  return numberOf(info?.context_window_tokens) || DEFAULT_CONTEXT_WINDOW_TOKENS
}

/** Characters each assistant message wrote, keyed by message id, from the session's event log. */
function assistantCharsByMessage(logPath: string): Map<string, number> {
  const chars = new Map<string, number>()
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return chars
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"AssistantMessage"')) {
      continue
    }
    try {
      const record: unknown = JSON.parse(line)
      const data = isRecord(record) && isRecord(record.data) ? record.data : null
      if (data && typeof data.message_id === 'string') {
        chars.set(data.message_id, JSON.stringify(data.content ?? '').length)
      }
    } catch {
      // A line kiro-cli is still writing.
    }
  }
  return chars
}

/**
 * kiro-cli bills in credits and logs zero tokens, so tokens are estimated from what it does log:
 * each request resends the context, which grows from the last turn's size to this turn's
 * (context_usage_percentage of the window). The part already sent before is counted as cached,
 * and output comes from the assistant text at about four characters per token.
 */
function turnBucket(
  turn: TurnRecord,
  previousContext: number | null,
  window: number,
  assistantChars: Map<string, number>
): { bucket: AccountUsageBucket; context: number } | null {
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
  const requests = Math.max(numberOf(turn.total_request_count), 1)
  const percent =
    numberOf(turn.final_context_usage_percentage) || numberOf(turn.context_usage_percentage)
  const context = Math.round((percent / 100) * window)
  const startContext = Math.min(previousContext ?? context, context)
  const promptPerRequest = (startContext + context) / 2
  const promptTokens = Math.round(promptPerRequest * requests)
  // A session's first request sends its whole context uncached.
  const freshContext = previousContext === null ? context : context - startContext
  const newInput = Math.min(
    promptTokens,
    freshContext + Math.round(numberOf(turn.user_prompt_length) / CHARS_PER_TOKEN)
  )
  const messageIds = Array.isArray(turn.message_ids) ? turn.message_ids : []
  const loggedChars = messageIds.reduce<number>(
    (sum, id) => sum + (typeof id === 'string' ? (assistantChars.get(id) ?? 0) : 0),
    0
  )
  const outputChars = loggedChars || numberOf(turn.assistant_response_length)
  const output = Math.round(outputChars / CHARS_PER_TOKEN)
  const logged = {
    input: numberOf(turn.input_token_count),
    output: numberOf(turn.output_token_count),
    cache:
      numberOf(turn.cache_read_input_token_count) + numberOf(turn.cache_write_input_token_count)
  }
  // Why: a kiro-cli build that reports real tokens wins over the estimate.
  const hasLogged = logged.input + logged.output + logged.cache > 0
  const inputTokens = hasLogged ? logged.input : newInput
  const outputTokens = hasLogged ? logged.output : output
  const cacheTokens = hasLogged ? logged.cache : Math.max(promptTokens - newInput, 0)
  return {
    context,
    bucket: {
      day,
      model: typeof turn.model === 'string' ? turn.model : null,
      inputTokens,
      outputTokens,
      cacheTokens,
      reasoningTokens: 0,
      totalTokens: inputTokens + outputTokens + cacheTokens,
      activity: requests,
      credits,
      costUsd: null,
      ...(hasLogged ? {} : { estimated: true })
    }
  }
}

const cache = new Map<string, { stamp: string; rollups: UsageSourceRollup[] }>()

function stampOf(paths: readonly string[]): string {
  return paths.map((path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0).join(':')
}

/** Credits, requests and estimated tokens from every kiro-cli chat session. */
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
    const logPath = path.replace(/\.json$/, '.jsonl')
    try {
      const stamp = stampOf([path, logPath])
      const cached = cache.get(path)
      if (cached && cached.stamp === stamp) {
        rollups.push(...cached.rollups)
        continue
      }
      const session: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const sessionId =
        isRecord(session) && typeof session.session_id === 'string'
          ? session.session_id
          : name.replace(/\.json$/, '')
      const window = contextWindowOf(session)
      const chars = assistantCharsByMessage(logPath)
      const builder = new SourceRollupBuilder()
      let previousContext: number | null = null
      for (const turn of turnsOf(session)) {
        const read = turnBucket(turn, previousContext, window, chars)
        if (read) {
          builder.add({ source: sessionId, home: null, session: sessionId }, read.bucket)
          previousContext = read.context
        }
      }
      const built = builder.build()
      cache.set(path, { stamp, rollups: built })
      rollups.push(...built)
    } catch {
      // kiro-cli may be mid-write; the next collection reads it whole.
    }
  }
  return rollups
}
