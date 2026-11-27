import { open, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redactString } from '../../shared/observability/redactor'
import type {
  BackgroundTaskShellProgress,
  BackgroundTaskShellRecord
} from '../../shared/delegation/background-tasks-types'

/** Fork: parses Claude Code background `.output` logs & step progress counters (FORK.md §13). */

const TAIL_READ_BYTES = 16_384
const RECENT_SETTLED_TASK_MS = 30 * 60_000
// oxlint-disable-next-line no-control-regex -- Strip terminal ANSI sequences from build output tails.
const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\r/g
const EXITED_TRAILER_RE = /\[exited with code (\d+)\]\s*$/
const NINJA_STEP_RE = /\[(\d{1,7})\s*\/\s*(\d{1,7})\]/g
const WORD_STEP_RE =
  /\b(?:step|building|compiling|task|progress)\b[^\n\d]{0,24}(\d{1,6})\s*\/\s*(\d{1,6})/gi
const PERCENT_RE = /(?:^|[\s([:])(\d{1,3}(?:\.\d+)?)\s*%/g

export type ClaudeTaskOutputSnapshot = {
  taskId: string
  outputTail: string | null
  progress: BackgroundTaskShellProgress | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
  exitCode: number | null
  inferredCommand: string | null
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

export function parseShellOutputProgress(rawText: string): BackgroundTaskShellProgress | null {
  const clean = rawText.replace(ANSI_ESCAPE_RE, '')
  let lastStep: { done: number; total: number } | null = null

  for (const match of clean.matchAll(NINJA_STEP_RE)) {
    const done = Number.parseInt(match[1] ?? '', 10)
    const total = Number.parseInt(match[2] ?? '', 10)
    if (
      Number.isFinite(done) &&
      Number.isFinite(total) &&
      total >= 2 &&
      done >= 0 &&
      done <= total
    ) {
      lastStep = { done, total }
    }
  }

  if (!lastStep) {
    for (const match of clean.matchAll(WORD_STEP_RE)) {
      const done = Number.parseInt(match[1] ?? '', 10)
      const total = Number.parseInt(match[2] ?? '', 10)
      if (
        Number.isFinite(done) &&
        Number.isFinite(total) &&
        total >= 2 &&
        done >= 0 &&
        done <= total
      ) {
        lastStep = { done, total }
      }
    }
  }

  if (lastStep) {
    const percent = Math.min(99.5, Math.max(0.5, (lastStep.done / lastStep.total) * 100))
    return {
      completedSteps: lastStep.done,
      totalSteps: lastStep.total,
      percent,
      label: `${formatNumber(lastStep.done)} / ${formatNumber(lastStep.total)} (${Math.round(percent)}%)`
    }
  }

  let lastPercent: number | null = null
  for (const match of clean.matchAll(PERCENT_RE)) {
    const pct = Number.parseFloat(match[1] ?? '')
    if (Number.isFinite(pct) && pct > 0 && pct < 100) {
      lastPercent = pct
    }
  }
  if (lastPercent !== null) {
    return {
      completedSteps: null,
      totalSteps: null,
      percent: lastPercent,
      label: `${Math.round(lastPercent)}%`
    }
  }

  return null
}

function extractCleanTailLine(rawText: string): {
  tail: string | null
  inferredCommand: string | null
} {
  const clean = rawText.replace(ANSI_ESCAPE_RE, '')
  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !EXITED_TRAILER_RE.test(line))

  let inferredCommand: string | null = null
  if (
    lines.some((line) => line.includes('"_keepalive":true') && line.includes('"_heartbeat":true'))
  ) {
    inferredCommand = 'orca orchestration check --wait'
  }

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line || (line.startsWith('{') && line.includes('"_keepalive":true'))) {
      continue
    }
    return {
      tail: redactString(line).slice(0, 220),
      inferredCommand
    }
  }
  return { tail: null, inferredCommand }
}

async function readTailUtf8(filePath: string, fileSize: number): Promise<string> {
  if (fileSize <= 0) {
    return ''
  }
  const readLen = Math.min(TAIL_READ_BYTES, fileSize)
  const offset = Math.max(0, fileSize - readLen)
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(readLen)
    const { bytesRead } = await handle.read(buffer, 0, readLen, offset)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

function encodeClaudeProjectDirName(worktreePath: string): string {
  return worktreePath.replace(/[^a-zA-Z0-9]/g, '-')
}

function claudeTmpCandidateRoots(): string[] {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const suffix = uid !== null ? `claude-${uid}` : 'claude'
  const roots = new Set<string>()
  if (process.platform !== 'win32') {
    roots.add(join('/private/tmp', suffix))
    roots.add(join('/tmp', suffix))
  }
  roots.add(join(tmpdir(), suffix))
  return [...roots]
}

async function findClaudeTasksDir(
  worktreePath: string | null,
  sessionId: string
): Promise<string | null> {
  const roots = claudeTmpCandidateRoots()
  if (worktreePath) {
    const encoded = encodeClaudeProjectDirName(worktreePath)
    for (const root of roots) {
      const candidate = join(root, encoded, sessionId, 'tasks')
      const info = await stat(candidate).catch(() => null)
      if (info?.isDirectory()) {
        return candidate
      }
    }
  }
  for (const root of roots) {
    const projects = await readdir(root).catch(() => [])
    for (const project of projects) {
      const candidate = join(root, project, sessionId, 'tasks')
      const info = await stat(candidate).catch(() => null)
      if (info?.isDirectory()) {
        return candidate
      }
    }
  }
  return null
}

export async function readClaudeSessionTaskOutputs(args: {
  worktreePath: string | null
  sessionId: string
  nowMs: number
}): Promise<ClaudeTaskOutputSnapshot[]> {
  const tasksDir = await findClaudeTasksDir(args.worktreePath, args.sessionId)
  if (!tasksDir) {
    return []
  }
  const names = await readdir(tasksDir).catch(() => [])
  const outputFiles = names.filter((name) => name.endsWith('.output')).slice(0, 24)
  const snapshots: ClaudeTaskOutputSnapshot[] = []

  for (const name of outputFiles) {
    const fullPath = join(tasksDir, name)
    const fileStat = await stat(fullPath).catch(() => null)
    if (!fileStat?.isFile()) {
      continue
    }
    const startedAt =
      Number.isFinite(fileStat.birthtimeMs) && fileStat.birthtimeMs > 0
        ? Math.round(fileStat.birthtimeMs)
        : Math.round(fileStat.ctimeMs)
    const updatedAt = Math.round(fileStat.mtimeMs)
    const tailText = await readTailUtf8(fullPath, fileStat.size).catch(() => '')
    const exitMatch = EXITED_TRAILER_RE.exec(tailText)
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? '0', 10) : null
    if (exitCode !== null && args.nowMs - updatedAt > RECENT_SETTLED_TASK_MS) {
      continue
    }
    const { tail, inferredCommand } = extractCleanTailLine(tailText)
    snapshots.push({
      taskId: name.slice(0, -'.output'.length),
      outputTail: tail,
      progress: exitCode === null ? parseShellOutputProgress(tailText) : null,
      startedAt,
      updatedAt,
      completedAt: exitCode !== null ? updatedAt : null,
      exitCode,
      inferredCommand
    })
  }

  snapshots.sort((a, b) => {
    const aRunning = a.exitCode === null ? 0 : 1
    const bRunning = b.exitCode === null ? 0 : 1
    return aRunning !== bRunning ? aRunning - bRunning : b.updatedAt - a.updatedAt
  })
  return snapshots
}

export function buildShellRecordsFromClaudeOutputs(args: {
  paneKey: string
  worktreeId: string | null
  agent: string | null
  runningCommands: readonly string[]
  outputs: readonly ClaudeTaskOutputSnapshot[]
  nowMs: number
}): BackgroundTaskShellRecord[] {
  const runningOutputs = args.outputs.filter((out) => out.exitCode === null)
  const settledOutputs = args.outputs.filter((out) => out.exitCode !== null)
  const records: BackgroundTaskShellRecord[] = []

  const count = Math.max(args.runningCommands.length, runningOutputs.length)
  for (let i = 0; i < count; i += 1) {
    const cmd = args.runningCommands[i]
    const out = runningOutputs[i]
    if (!cmd && !out) {
      continue
    }
    // Only treat an unmatched `.output` file without an exit trailer as live if it updated recently or hook says a shell is running.
    if (
      !cmd &&
      out &&
      args.runningCommands.length === 0 &&
      args.nowMs - out.updatedAt > 15 * 60_000
    ) {
      continue
    }
    records.push({
      id: `shell:${args.paneKey}:${out?.taskId ?? `cmd-${i}`}`,
      paneKey: args.paneKey,
      worktreeId: args.worktreeId,
      agent: args.agent,
      command: cmd ?? out?.inferredCommand ?? 'Background shell',
      outputTail: out?.outputTail ?? null,
      progress: out?.progress ?? null,
      pid: null,
      cpuPercent: null,
      state: 'running',
      startedAt: out?.startedAt ?? args.nowMs,
      updatedAt: out?.updatedAt ?? args.nowMs,
      completedAt: null,
      exitCode: null
    })
  }

  for (const settled of settledOutputs.slice(0, 4)) {
    records.push({
      id: `shell:${args.paneKey}:${settled.taskId}`,
      paneKey: args.paneKey,
      worktreeId: args.worktreeId,
      agent: args.agent,
      command: settled.inferredCommand ?? `Background shell (${settled.taskId})`,
      outputTail: settled.outputTail,
      progress: null,
      pid: null,
      cpuPercent: null,
      state: settled.exitCode === 0 ? 'done' : 'failed',
      startedAt: settled.startedAt,
      updatedAt: settled.updatedAt,
      completedAt: settled.completedAt,
      exitCode: settled.exitCode
    })
  }

  return records
}
