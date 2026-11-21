import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import Database from '../sqlite/sync-database'
import {
  protoMessage,
  protoString,
  protoVarint,
  readProtoFields
} from '../usage/protobuf-wire-reader'
import { SourceRollupBuilder } from '../usage/usage-source-rollups'
import type { tokensPerStep } from '../usage/account-usage-buckets'

const SUMMARIES_KEY = 'antigravityUnifiedStateSync.trajectorySummaries'
const IDE_MODEL = 'antigravity-ide'

export type IdeTokensPerStep = NonNullable<ReturnType<typeof tokensPerStep>>

function stateDbPath(home: string): string {
  return process.platform === 'darwin'
    ? join(
        home,
        'Library',
        'Application Support',
        'Antigravity',
        'User',
        'globalStorage',
        'state.vscdb'
      )
    : join(home, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb')
}

function localDay(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

type IdeConversation = { id: string; steps: number; startMs: number }

/**
 * The IDE keeps one summary per conversation in its VS Code state store: field 1 the id, and
 * field 2.1 a base64 summary whose field 2 is the step count, 7 the start and 3 the last change.
 */
function readIdeConversations(dbPath: string): IdeConversation[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(SUMMARIES_KEY)
    const value = row?.value
    const text =
      typeof value === 'string'
        ? value
        : value instanceof Uint8Array
          ? new TextDecoder().decode(value)
          : null
    if (!text) {
      return []
    }
    const conversations: IdeConversation[] = []
    for (const entry of readProtoFields(decodeBase64(text.trim())) ?? []) {
      if (entry.field !== 1 || entry.kind !== 'bytes') {
        continue
      }
      const fields = readProtoFields(entry.value) ?? []
      const id = protoString(fields, 1)
      const wrapper = protoMessage(fields, 2)
      const encoded = wrapper ? protoString(wrapper, 1) : null
      const summary = encoded ? readProtoFields(decodeBase64(encoded)) : null
      if (!id || !summary) {
        continue
      }
      const end = protoMessage(summary, 3)
      const start = protoMessage(summary, 7)
      const endSeconds = end ? protoVarint(end, 1) : null
      if (endSeconds === null) {
        continue
      }
      const startSeconds = (start ? protoVarint(start, 1) : null) ?? endSeconds
      conversations.push({
        id,
        steps: protoVarint(summary, 2) ?? 0,
        startMs: Math.min(startSeconds, endSeconds) * 1000
      })
    }
    return conversations
  } finally {
    db.close()
  }
}

let cached: { stamp: number; conversations: IdeConversation[] } | null = null

/**
 * The Antigravity IDE logs no tokens, only how many steps each conversation took. Tokens are
 * estimated at the per-step rate measured in this machine's agy CLI logs.
 */
export function collectAntigravityIdeUsage(
  perStep: IdeTokensPerStep,
  home = homedir()
): UsageSourceRollup[] {
  const path = stateDbPath(home)
  let conversations: IdeConversation[]
  try {
    const stamp = statSync(path).mtimeMs
    if (cached?.stamp !== stamp) {
      cached = { stamp, conversations: readIdeConversations(path) }
    }
    conversations = cached.conversations
  } catch {
    return []
  }
  const builder = new SourceRollupBuilder()
  for (const conversation of conversations) {
    if (conversation.steps <= 0) {
      continue
    }
    // Why the start day: the total grows in place, so a later day would count it twice.
    const scale = (value: number): number => Math.round(value * conversation.steps)
    const bucket: AccountUsageBucket = {
      day: localDay(conversation.startMs),
      model: IDE_MODEL,
      inputTokens: scale(perStep.split.inputTokens),
      outputTokens: scale(perStep.split.outputTokens),
      cacheTokens: scale(perStep.split.cacheTokens),
      reasoningTokens: scale(perStep.split.reasoningTokens),
      totalTokens: 0,
      activity: conversation.steps,
      credits: 0,
      costUsd: null,
      estimated: true
    }
    bucket.totalTokens = bucket.inputTokens + bucket.outputTokens + bucket.cacheTokens
    builder.add(
      { source: `antigravity-ide:${conversation.id}`, home: null, session: conversation.id },
      bucket
    )
  }
  return builder.build()
}
