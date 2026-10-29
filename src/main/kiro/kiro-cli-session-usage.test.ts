import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectKiroCliUsage } from './kiro-cli-session-usage'

let root: string | null = null

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = null
})

function writeSession(turns: unknown[]): string {
  root = mkdtempSync(join(tmpdir(), 'kiro-usage-'))
  const dir = join(root, 'sessions', 'cli')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'abc.json'),
    JSON.stringify({
      session_id: 'abc',
      session_state: { conversation_metadata: { user_turn_metadatas: turns } }
    })
  )
  return root
}

describe('collectKiroCliUsage', () => {
  it('sums credits and requests per day and model from each turn', () => {
    const home = writeSession([
      {
        end_timestamp: '2026-10-20T10:00:00Z',
        model: 'claude-opus-5.5',
        total_request_count: 3,
        input_token_count: 0,
        metering_usage: [
          { value: 1.5, unit: 'credit' },
          { value: 2, unit: 'credit' }
        ]
      },
      { end_timestamp: '2026-10-20T11:00:00Z', model: 'claude-opus-5.5', total_request_count: 1 },
      { model: 'claude-opus-5.5', metering_usage: [{ value: 9, unit: 'credit' }] }
    ])
    const [rollup] = collectKiroCliUsage(home)
    expect(rollup.source).toBe('abc')
    expect(rollup.buckets).toHaveLength(1)
    expect(rollup.buckets[0]).toMatchObject({
      model: 'claude-opus-5.5',
      credits: 3.5,
      activity: 4,
      totalTokens: 0
    })
  })

  it('estimates tokens from context growth and output length when kiro logs none', () => {
    const home = writeSession([
      {
        end_timestamp: '2026-10-20T10:00:00Z',
        model: 'm',
        total_request_count: 2,
        context_usage_percentage: 10,
        assistant_response_length: 400
      },
      {
        end_timestamp: '2026-10-20T11:00:00Z',
        model: 'm',
        total_request_count: 4,
        final_context_usage_percentage: 20,
        user_prompt_length: 40,
        assistant_response_length: 800
      }
    ])
    const [bucket] = collectKiroCliUsage(home)[0].buckets
    // Turn 1: 2 requests at 100k, all new once; turn 2: 4 requests averaging 150k, 100k of it new.
    expect(bucket).toMatchObject({
      inputTokens: 200_010,
      outputTokens: 300,
      cacheTokens: 200_000 + 600_000 - 200_010,
      estimated: true
    })
  })
})
