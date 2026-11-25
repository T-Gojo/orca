// Fork: upstream deleted scanner-paths.test.ts with the rest of its low-value scanner
// suite; these two cases guard the fork's history-never-shrinks rule (FORK.md §5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'

const { getPathMock, homedirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
  homedirMock: vi.fn<() => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return {
    ...actual,
    homedir: homedirMock
  }
})
import { scanCodexUsageFiles } from './scanner'

const originalCodexHome = process.env.CODEX_HOME
let fakeHomeDir: string
let userDataDir: string
let previousUserDataPath: string | undefined

function usageRecord(
  timestamp: string,
  inputTokens: number,
  totalInputTokens = inputTokens
): string {
  return `${JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        model: 'gpt-5-codex',
        last_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: inputTokens
        },
        total_token_usage: {
          input_tokens: totalInputTokens,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: totalInputTokens
        }
      }
    }
  })}\n`
}

beforeEach(() => {
  delete process.env.CODEX_HOME
  fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-codex-usage-home-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-codex-usage-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userDataDir
  homedirMock.mockReturnValue(fakeHomeDir)
  getPathMock.mockImplementation((name: string) => {
    if (name === 'userData') {
      return userDataDir
    }
    throw new Error(`unexpected app.getPath(${name})`)
  })
})

afterEach(() => {
  rmSync(fakeHomeDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

describe('scanCodexUsageFiles history retention', () => {
  it("keeps a deleted rollout's usage as history", async () => {
    const sessionsDir = join(userDataDir, 'codex-runtime-home', 'home', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const rolloutPath = join(sessionsDir, 'aaaa-rollout.jsonl')
    writeFileSync(
      rolloutPath,
      [
        `${JSON.stringify({
          type: 'session_meta',
          payload: { id: 'session-1', cwd: join(fakeHomeDir, 'repo') }
        })}\n`,
        usageRecord('2026-05-26T12:00:00.000Z', 10)
      ].join('')
    )
    const first = await scanCodexUsageFiles([], [])
    unlinkSync(rolloutPath)

    const second = await scanCodexUsageFiles([], first.processedFiles)

    expect(second.dailyAggregates).toEqual(first.dailyAggregates)
    expect(second.processedFiles).toEqual(first.processedFiles)
  })

  it('counts a deleted legacy copy\'s own event as history after bridge markers go', async () => {
    const runtimeSessionsDir = join(userDataDir, 'codex-runtime-home', 'home', 'sessions')
    const runtimeBridgeMarkerDir = join(
      userDataDir,
      'codex-runtime-home',
      'home',
      '.orca-session-copies'
    )
    const systemSessionsDir = join(fakeHomeDir, '.codex', 'sessions')
    mkdirSync(runtimeSessionsDir, { recursive: true })
    mkdirSync(runtimeBridgeMarkerDir, { recursive: true })
    mkdirSync(systemSessionsDir, { recursive: true })
    const systemSessionPath = join(systemSessionsDir, 'system.jsonl')
    const runtimeSessionPath = join(runtimeSessionsDir, 'system.jsonl')
    const copiedPrefix = [
      `${JSON.stringify({
        type: 'session_meta',
        payload: { id: 'legacy-session', cwd: join(fakeHomeDir, 'repo') }
      })}\n`,
      usageRecord('2026-05-26T12:00:00.000Z', 10)
    ].join('')
    writeFileSync(systemSessionPath, copiedPrefix, 'utf-8')
    writeFileSync(runtimeSessionPath, copiedPrefix, 'utf-8')
    const sourceStat = lstatSync(systemSessionPath)
    const targetStat = lstatSync(runtimeSessionPath)
    writeFileSync(
      join(runtimeBridgeMarkerDir, 'system.jsonl.json'),
      `${JSON.stringify(
        {
          sourcePath: systemSessionPath,
          sourceSize: sourceStat.size,
          sourceMtimeMs: sourceStat.mtimeMs,
          targetSize: targetStat.size,
          targetMtimeMs: targetStat.mtimeMs
        },
        null,
        2
      )}\n`,
      'utf-8'
    )
    writeFileSync(
      systemSessionPath,
      `${copiedPrefix}${usageRecord('2026-05-26T12:01:00.000Z', 3, 13)}`
    )
    writeFileSync(
      runtimeSessionPath,
      `${copiedPrefix}${usageRecord('2026-05-26T12:02:00.000Z', 5, 15)}`
    )

    const result = await scanCodexUsageFiles([], [])
    expect(
      result.dailyAggregates.reduce((total, aggregate) => total + aggregate.totalTokens, 0)
    ).toBe(18)
    expect(
      result.dailyAggregates.reduce((total, aggregate) => total + aggregate.eventCount, 0)
    ).toBe(3)

    // Removing bridge markers must restore full-history parsing, including the skipped prefix;
    // the deleted copy's own event (15 tokens) stays counted as history.
    rmSync(runtimeBridgeMarkerDir, { recursive: true, force: true })
    rmSync(runtimeSessionPath)
    writeFileSync(
      systemSessionPath,
      `${copiedPrefix}${usageRecord('2026-05-26T12:01:00.000Z', 3, 13)}${usageRecord('2026-05-26T12:03:00.000Z', 4, 17)}`
    )

    const afterBridge = await scanCodexUsageFiles([], result.processedFiles)

    expect(
      afterBridge.dailyAggregates.reduce((total, aggregate) => total + aggregate.totalTokens, 0)
    ).toBe(32)
    expect(
      afterBridge.dailyAggregates.reduce((total, aggregate) => total + aggregate.eventCount, 0)
    ).toBe(5)
  })
})
