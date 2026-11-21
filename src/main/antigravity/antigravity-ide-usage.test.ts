import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../sqlite/sync-database'
import { collectAntigravityIdeUsage } from './antigravity-ide-usage'

function varint(value: number): number[] {
  const bytes: number[] = []
  let rest = value
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80)
    rest = Math.floor(rest / 0x80)
  }
  bytes.push(rest)
  return bytes
}

function field(number: number, value: number | number[] | string): number[] {
  if (typeof value === 'number') {
    return [...varint(number * 8), ...varint(value)]
  }
  const bytes = typeof value === 'string' ? [...Buffer.from(value)] : value
  return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes]
}

function conversation(id: string, steps: number, startSeconds: number): number[] {
  const summary = [
    ...field(2, steps),
    ...field(3, field(1, startSeconds + 3600)),
    ...field(7, field(1, startSeconds))
  ]
  return field(1, [...field(1, id), ...field(2, field(1, Buffer.from(summary).toString('base64')))])
}

let root: string | null = null

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = null
})

describe('collectAntigravityIdeUsage', () => {
  it('estimates each conversation from its step count at the measured rate', () => {
    root = mkdtempSync(join(tmpdir(), 'agy-ide-'))
    const dir =
      process.platform === 'darwin'
        ? join(root, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage')
        : join(root, '.config', 'Antigravity', 'User', 'globalStorage')
    mkdirSync(dir, { recursive: true })
    const db = new Database(join(dir, 'state.vscdb'))
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)')
    const value = Buffer.from([
      ...conversation('a', 10, 1_790_000_000),
      ...conversation('b', 0, 1_790_000_000)
    ]).toString('base64')
    db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
      'antigravityUnifiedStateSync.trajectorySummaries',
      value
    )
    db.close()

    const rollups = collectAntigravityIdeUsage(
      {
        tokens: 110,
        split: { inputTokens: 10, outputTokens: 5, cacheTokens: 95, reasoningTokens: 1 }
      },
      root
    )
    expect(rollups).toHaveLength(1)
    expect(rollups[0].source).toBe('antigravity-ide:a')
    expect(rollups[0].buckets[0]).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cacheTokens: 950,
      totalTokens: 1100,
      activity: 10,
      estimated: true
    })
  })
})
