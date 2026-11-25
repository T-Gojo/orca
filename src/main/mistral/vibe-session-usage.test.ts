// Fork: Mistral Vibe session usage collection (FORK.md §10). Handwritten fixture sessions
// mirror mistral-vibe's real journal shape (verified against 3.1.4 session dirs).
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectMistralVibeUsage } from './vibe-session-usage'

// Mid-day UTC stamps keep the local calendar day stable on any timezone within UTC±12.
const DAY_ONE_MS = Date.UTC(2024, 5, 14, 12, 0, 0)
const DAY_TWO_MS = Date.UTC(2024, 5, 15, 12, 0, 0)
const DAY_THREE_MS = Date.UTC(2024, 5, 16, 9, 0, 0)

/** One journal record, exactly the shape mistral-vibe writes: a projection_delta envelope. */
function journalRecord(
  usage: { cachedInputTokens: number; inputTokens: number; outputTokens: number },
  updatedAt: number,
  watermark: number
): string {
  return `${JSON.stringify({
    type: 'projection_delta',
    payload: {
      delta: [
        {
          op: 'set_envelope',
          state: {
            session: {
              tokenUsage: {
                cachedInputTokens: usage.cachedInputTokens,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                // mistral-vibe's totals leave cached tokens out: input + output.
                totalTokens: usage.inputTokens + usage.outputTokens
              },
              updatedAt
            }
          }
        }
      ],
      watermark
    },
    previous_record_sha256: 'fixture',
    record_sha256: 'fixture',
    sequence: watermark,
    recovery_journal_record_version: 1
  })}\n`
}

/** A projection_delta that carries no token usage, like the ones between metered steps. */
function journalNoiseRecord(): string {
  return `${JSON.stringify({
    type: 'projection_delta',
    payload: {
      delta: [{ op: 'set_envelope', state: { session: { status: { type: 'running' } } } }]
    },
    watermark: 0
  })}\n`
}

function writeSession(
  vibeHome: string,
  id: string,
  files: { name: string; contents: string }[]
): void {
  const dir = join(vibeHome, 'logs', 'session', 'unified', id)
  mkdirSync(join(dir, 'journal'), { recursive: true })
  for (const { name, contents } of files) {
    writeFileSync(join(dir, name), contents)
  }
}

function metaJson(model: { activeModel?: string; modelName?: string }): string {
  return `${JSON.stringify({
    session_id: 'fixture',
    start_time: '2024-06-14T10:00:00.000000+00:00',
    title: 'fixture',
    config: {
      ...(model.activeModel ? { active_model: model.activeModel } : {}),
      ...(model.modelName ? { model_name: model.modelName } : {})
    }
  })}\n`
}

function ownerJson(organizationId: string, userId: string): string {
  return `${JSON.stringify({
    account: { organizationId, userId, workspaceId: 'workspace-fixture' },
    entrypoint: 'desktop'
  })}\n`
}

function fixtureVibeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'orca-mistral-vibe-home-'))
  return join(home, '.vibe')
}

describe('collectMistralVibeUsage', () => {
  it('reads a session through cumulative records across two journal segments', () => {
    const vibeHome = fixtureVibeHome()
    try {
      writeSession(vibeHome, 'session-a', [
        {
          name: 'meta.json',
          contents: metaJson({ activeModel: 'zai-glm-5-3', modelName: 'ignored-when-set' })
        },
        { name: 'owner.json', contents: ownerJson('org-a', 'user-a') },
        {
          name: 'journal/0000000000000001.jsonl',
          contents: `${journalNoiseRecord()}${journalRecord({ cachedInputTokens: 20, inputTokens: 100, outputTokens: 50 }, DAY_ONE_MS, 1)}`
        },
        {
          name: 'journal/0000000000000002.jsonl',
          // The trailing fragment is a line mistral-vibe is still writing; the session must survive it.
          contents: `${journalRecord({ cachedInputTokens: 80, inputTokens: 200, outputTokens: 120 }, DAY_TWO_MS, 2)}{"type":"projection_de`
        }
      ])
      const rollups = collectMistralVibeUsage(vibeHome).sort((a, b) =>
        a.source.localeCompare(b.source)
      )
      expect(rollups).toEqual([
        {
          source: 'session-a',
          home: null,
          session: 'org-a+user-a',
          buckets: [
            {
              day: '2024-06-14',
              model: 'zai-glm-5-3',
              inputTokens: 80,
              outputTokens: 50,
              cacheTokens: 20,
              reasoningTokens: 0,
              totalTokens: 150,
              activity: 1,
              credits: 0,
              costUsd: null
            },
            {
              day: '2024-06-15',
              model: 'zai-glm-5-3',
              inputTokens: 40,
              outputTokens: 70,
              cacheTokens: 60,
              reasoningTokens: 0,
              totalTokens: 170,
              activity: 1,
              credits: 0,
              costUsd: null
            }
          ],
          hourlyBuckets: [
            {
              hour: '2024-06-14T12',
              model: 'zai-glm-5-3',
              inputTokens: 80,
              outputTokens: 50,
              cacheTokens: 20,
              reasoningTokens: 0,
              totalTokens: 150,
              activity: 1,
              credits: 0,
              costUsd: null
            },
            {
              hour: '2024-06-15T12',
              model: 'zai-glm-5-3',
              inputTokens: 40,
              outputTokens: 70,
              cacheTokens: 60,
              reasoningTokens: 0,
              totalTokens: 170,
              activity: 1,
              credits: 0,
              costUsd: null
            }
          ]
        }
      ])
    } finally {
      rmSync(vibeHome, { recursive: true, force: true })
    }
  })

  it('attributes a session without owner.json to the unknown bucket and keeps its day', () => {
    const vibeHome = fixtureVibeHome()
    try {
      writeSession(vibeHome, 'session-b', [
        { name: 'meta.json', contents: metaJson({ modelName: 'mistral-medium-latest' }) },
        {
          name: 'journal/0000000000000001.jsonl',
          contents: journalRecord(
            { cachedInputTokens: 10, inputTokens: 30, outputTokens: 5 },
            DAY_THREE_MS,
            1
          )
        }
      ])
      // A session with no journal at all counts nothing.
      writeSession(vibeHome, 'session-empty', [
        { name: 'meta.json', contents: metaJson({ modelName: 'zai-glm-5-3' }) }
      ])
      const rollups = collectMistralVibeUsage(vibeHome).sort((a, b) =>
        a.source.localeCompare(b.source)
      )
      expect(rollups).toEqual([
        {
          source: 'session-b',
          home: null,
          session: '',
          buckets: [
            {
              day: '2024-06-16',
              model: 'mistral-medium-latest',
              inputTokens: 20,
              outputTokens: 5,
              cacheTokens: 10,
              reasoningTokens: 0,
              totalTokens: 35,
              activity: 1,
              credits: 0,
              costUsd: null
            }
          ],
          hourlyBuckets: [
            {
              hour: '2024-06-16T09',
              model: 'mistral-medium-latest',
              inputTokens: 20,
              outputTokens: 5,
              cacheTokens: 10,
              reasoningTokens: 0,
              totalTokens: 35,
              activity: 1,
              credits: 0,
              costUsd: null
            }
          ]
        }
      ])
    } finally {
      rmSync(vibeHome, { recursive: true, force: true })
    }
  })

  it('returns no rollups when no Mistral Vibe home exists', () => {
    expect(collectMistralVibeUsage(join(tmpdir(), 'orca-mistral-vibe-missing'))).toEqual([])
  })
})
