import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import Database from '../sqlite/sync-database'
import {
  protoMessage,
  protoString,
  protoVarint,
  readProtoFields
} from '../usage/protobuf-wire-reader'
import { SourceRollupBuilder } from '../usage/usage-source-rollups'

// agy keeps each conversation in its own SQLite file; the IDE folder is read too for older installs.
function conversationDirs(home: string): string[] {
  return [
    join(home, '.gemini', 'antigravity-cli', 'conversations'),
    join(home, '.gemini', 'antigravity', 'conversations')
  ]
}

function localDay(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Model ids are numbers on each step; a request's settings pair the number with its name. */
function readModelNames(db: Database): Map<number, string> {
  const names = new Map<number, string>()
  for (const row of db.prepare('SELECT data FROM gen_metadata').iterate()) {
    const data = row.data
    if (!(data instanceof Uint8Array)) {
      continue
    }
    const settings = protoMessage(readProtoFields(data) ?? [], 3)
    const id = settings ? protoVarint(settings, 1) : null
    const name = settings ? protoString(settings, 28) : null
    if (id !== null && name) {
      names.set(id, name)
    }
  }
  return names
}

/**
 * Token use per model call, read from step metadata field 9: 2 new input, 5 cached input,
 * 3 output (of which 9 is thinking), 11 the response id that marks repeats of one call.
 */
function readConversation(path: string, builder: SourceRollupBuilder): void {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const models = readModelNames(db)
    const seenResponses = new Set<string>()
    for (const row of db.prepare('SELECT metadata FROM steps WHERE metadata IS NOT NULL').all()) {
      const metadata = row.metadata
      if (!(metadata instanceof Uint8Array)) {
        continue
      }
      const fields = readProtoFields(metadata)
      const usage = fields ? protoMessage(fields, 9) : null
      const createdAt = fields ? protoMessage(fields, 1) : null
      const seconds = createdAt ? protoVarint(createdAt, 1) : null
      if (!usage || seconds === null) {
        continue
      }
      const responseId = protoString(usage, 11)
      if (responseId) {
        if (seenResponses.has(responseId)) {
          continue
        }
        seenResponses.add(responseId)
      }
      const input = protoVarint(usage, 2) ?? 0
      const output = protoVarint(usage, 3) ?? 0
      const cached = protoVarint(usage, 5) ?? 0
      const modelId = protoVarint(usage, 1)
      builder.add(
        { source: path, home: null, session: null },
        {
          day: localDay(seconds),
          model: modelId === null ? null : (models.get(modelId) ?? `model-${modelId}`),
          inputTokens: input,
          outputTokens: output,
          cacheTokens: cached,
          reasoningTokens: protoVarint(usage, 9) ?? 0,
          totalTokens: input + output + cached,
          activity: 1,
          credits: 0,
          costUsd: null
        }
      )
    }
  } finally {
    db.close()
  }
}

const cache = new Map<string, { mtimeMs: number; rollups: UsageSourceRollup[] }>()

/** Every agy conversation's token use; unchanged files reuse their last read. */
export function collectAntigravityUsage(home = homedir()): UsageSourceRollup[] {
  const rollups: UsageSourceRollup[] = []
  for (const dir of conversationDirs(home)) {
    let names: string[]
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.db'))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const mtimeMs = Math.max(
          statSync(path).mtimeMs,
          statSync(`${path}-wal`, { throwIfNoEntry: false })?.mtimeMs ?? 0
        )
        const cached = cache.get(path)
        if (cached && cached.mtimeMs === mtimeMs) {
          rollups.push(...cached.rollups)
          continue
        }
        const builder = new SourceRollupBuilder()
        readConversation(path, builder)
        const read = builder.build()
        cache.set(path, { mtimeMs, rollups: read })
        rollups.push(...read)
      } catch {
        // A conversation agy is still creating, or an unknown layout: skip it this round.
      }
    }
  }
  return rollups
}
