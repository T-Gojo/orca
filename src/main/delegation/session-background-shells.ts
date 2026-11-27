import { runProcess } from '@orca/process-host'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { redactString } from '../../shared/observability/redactor'
import type { BackgroundTaskShellRecord } from '../../shared/delegation/background-tasks-types'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import {
  buildShellRecordsFromClaudeOutputs,
  readClaudeSessionTaskOutputs
} from './claude-background-shell-logs'

/** Fork: discovers live background shells & OS descendant jobs per session pane (FORK.md §13). */

type PsProcessRow = {
  pid: number
  ppid: number
  cpuPercent: number
  elapsedMs: number
  command: string
}

const PS_CACHE_TTL_MS = 2_500
let cachedPsAt = 0
let cachedPsRows: PsProcessRow[] = []

const IGNORED_CHILD_RE =
  /\b(orca-hook|mcp-server|mcp[-_]|serena|context7|rikugan|chrome-devtools|threejs-devtools|mobilebuildmcp|open-pencil|kiln|dusk-mcp|gflow-dusk|elevenlabs-dusk|flowmusic-dusk|ps\s+-axo|rg\s+--files)\b/i
const SHELL_WRAPPER_RE =
  /^(?:\/usr\/bin\/login\b|(?:\/bin\/|\/usr\/bin\/|\/opt\/homebrew\/bin\/)?(?:zsh|bash|sh|fish|dash)\b(?:\s+-[a-zA-Z]+)*\s*$)/i
const AGENT_SELF_RE = /\b(?:claude|codex|kiro-cli|kiro|agy|antigravity|vibe|opencode)\b/i

export function parsePsElapsedMs(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed) {
    return 0
  }
  let days = 0
  let clock = trimmed
  const dashIdx = trimmed.indexOf('-')
  if (dashIdx > 0) {
    days = Number.parseInt(trimmed.slice(0, dashIdx), 10) || 0
    clock = trimmed.slice(dashIdx + 1)
  }
  const parts = clock.split(':').map((part) => Number.parseInt(part, 10) || 0)
  let seconds = 0
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1]
  } else if (parts.length === 1) {
    seconds = parts[0]
  }
  return (days * 86_400 + seconds) * 1_000
}

async function readPosixProcessTable(nowMs: number): Promise<PsProcessRow[]> {
  if (process.platform === 'win32') {
    return []
  }
  if (nowMs - cachedPsAt < PS_CACHE_TTL_MS && cachedPsRows.length > 0) {
    return cachedPsRows
  }
  const result = await runProcess({
    program: '/bin/ps',
    args: ['-axo', 'pid=,ppid=,pcpu=,etime=,command='],
    timeoutMs: 2_500,
    maxOutputBytes: 512 * 1024
  }).catch(() => null)
  if (!result || result.code !== 0) {
    return cachedPsRows
  }
  const rows: PsProcessRow[] = []
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d:-]+)\s+(.+)$/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number.parseInt(match[1] ?? '', 10)
    const ppid = Number.parseInt(match[2] ?? '', 10)
    const cpuPercent = Number.parseFloat(match[3] ?? '0')
    const elapsedMs = parsePsElapsedMs(match[4] ?? '')
    const command = (match[5] ?? '').trim()
    if (pid > 0 && command) {
      rows.push({
        pid,
        ppid,
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
        elapsedMs,
        command
      })
    }
  }
  cachedPsAt = nowMs
  cachedPsRows = rows
  return rows
}

function collectMeaningfulDescendants(
  rootPid: number,
  table: readonly PsProcessRow[]
): PsProcessRow[] {
  if (table.length === 0) {
    return []
  }
  const childrenByPpid = new Map<number, PsProcessRow[]>()
  for (const row of table) {
    const list = childrenByPpid.get(row.ppid)
    if (list) {
      list.push(row)
    } else {
      childrenByPpid.set(row.ppid, [row])
    }
  }

  const visited = new Set<number>([rootPid])
  const queue: number[] = [rootPid]
  const descendants: PsProcessRow[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of childrenByPpid.get(current) ?? []) {
      if (visited.has(child.pid)) {
        continue
      }
      visited.add(child.pid)
      queue.push(child.pid)
      if (IGNORED_CHILD_RE.test(child.command) || SHELL_WRAPPER_RE.test(child.command)) {
        continue
      }
      if (child.ppid === rootPid && AGENT_SELF_RE.test(child.command)) {
        continue
      }
      // Skip wrapper `/bin/zsh -c -l ...` when its real child command is also in the tree.
      if (/^(?:\/bin\/|\/usr\/bin\/)?(?:zsh|bash|sh)\s+-c\b/.test(child.command)) {
        const grandChildren = childrenByPpid.get(child.pid) ?? []
        if (grandChildren.some((gc) => !IGNORED_CHILD_RE.test(gc.command))) {
          continue
        }
      }
      descendants.push(child)
    }
  }
  return descendants
}

function extractWorktreePath(worktreeId: string | null): string | null {
  if (!worktreeId) {
    return null
  }
  return splitWorktreeIdForFilesystem(worktreeId)?.worktreePath ?? null
}

export async function collectSessionBackgroundShells(options?: {
  paneKey?: string
  worktreeId?: string
  nowMs?: number
}): Promise<BackgroundTaskShellRecord[]> {
  const nowMs = options?.nowMs ?? Date.now()
  const allContexts = agentHookServer.readPaneBackgroundShellContexts()
  const targetContexts = allContexts.filter((ctx) => {
    if (options?.paneKey && ctx.paneKey === options.paneKey) {
      return true
    }
    if (options?.worktreeId && ctx.worktreeId === options.worktreeId) {
      return true
    }
    return ctx.runningCommands.length > 0
  })

  if (targetContexts.length === 0) {
    return []
  }

  const needsPs = targetContexts.some((ctx) => ctx.agentPid !== null)
  const psTable = needsPs ? await readPosixProcessTable(nowMs) : []
  const shells: BackgroundTaskShellRecord[] = []

  for (const ctx of targetContexts) {
    const worktreePath = extractWorktreePath(ctx.worktreeId)
    const claudeOutputs =
      ctx.agentType === 'claude' && ctx.providerSessionId
        ? await readClaudeSessionTaskOutputs({
            worktreePath,
            sessionId: ctx.providerSessionId,
            nowMs
          })
        : []

    const paneShells =
      claudeOutputs.length > 0 || ctx.runningCommands.length > 0
        ? buildShellRecordsFromClaudeOutputs({
            paneKey: ctx.paneKey,
            worktreeId: ctx.worktreeId,
            agent: ctx.agentType,
            runningCommands: ctx.runningCommands,
            outputs: claudeOutputs,
            nowMs
          })
        : []

    const descendants =
      ctx.agentPid !== null ? collectMeaningfulDescendants(ctx.agentPid, psTable) : []

    if (paneShells.length > 0 && descendants.length > 0) {
      const totalCpu = descendants.reduce((sum, proc) => sum + proc.cpuPercent, 0)
      const primaryProc = [...descendants].sort((a, b) => b.cpuPercent - a.cpuPercent)[0]
      for (const rec of paneShells) {
        if (rec.state !== 'running') {
          continue
        }
        rec.pid = primaryProc?.pid ?? null
        rec.cpuPercent = Math.round(totalCpu * 10) / 10
        if (primaryProc && primaryProc.elapsedMs > 0 && rec.startedAt >= nowMs - 1_000) {
          rec.startedAt = nowMs - primaryProc.elapsedMs
        }
        if (!rec.outputTail && primaryProc && primaryProc.command !== rec.command) {
          rec.outputTail = redactString(primaryProc.command).slice(0, 220)
        }
      }
    } else if (
      paneShells.length === 0 &&
      descendants.length > 0 &&
      (ctx.paneKey === options?.paneKey || ctx.worktreeId === options?.worktreeId)
    ) {
      for (const proc of descendants.slice(0, 6)) {
        // Skip very short-lived (<3s) foreground helper invocations unless they burn significant CPU.
        if (proc.elapsedMs < 3_000 && proc.cpuPercent < 15) {
          continue
        }
        shells.push({
          id: `shell:${ctx.paneKey}:pid-${proc.pid}`,
          paneKey: ctx.paneKey,
          worktreeId: ctx.worktreeId,
          agent: ctx.agentType,
          command: redactString(proc.command).slice(0, 300),
          outputTail: null,
          progress: null,
          pid: proc.pid,
          cpuPercent: Math.round(proc.cpuPercent * 10) / 10,
          state: 'running',
          startedAt: Math.max(1, nowMs - proc.elapsedMs),
          updatedAt: nowMs,
          completedAt: null,
          exitCode: null
        })
      }
    }

    shells.push(...paneShells)
  }

  return shells
}
