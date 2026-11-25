import { z } from 'zod'
import type {
  AgentDurationPrior,
  BackgroundTasksSnapshot,
  BackgroundTaskWorkerRecord
} from '../../shared/delegation/background-tasks-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

/** Fork: Electron-free durable orchestration worker + empirical duration prior query (FORK.md §13). */

const DEFAULT_RECENT_MINUTES = 60
const MAX_WORKER_ROWS = 120
const MAX_PRIOR_ROWS = 500
const MIN_DURATION_SAMPLE_MS = 5_000
const MAX_DURATION_SAMPLE_MS = 4 * 60 * 60 * 1000
const SQLITE_UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/

type RawWorkerRow = {
  dispatch_id: string
  run_id: string
  task_id: string | null
  task_title: string | null
  display_name: string | null
  objective: string | null
  worker_state: string | null
  worker_stage: string | null
  dispatch_status: string
  pane_key: string | null
  worktree_id: string | null
  terminal_handle: string | null
  start_options: string | null
  started_at: string | null
  updated_at: string | null
  completed_at: string | null
  last_error: string | null
  message_count: number | null
}

type RawCompletedDurationRow = {
  start_options: string | null
  started_at: string | null
  completed_at: string | null
}

type ParsedStartOptions = {
  agent: string | null
  model: string | null
  account: string | null
}

function toSqliteUtcTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function parseTimestampMs(raw: string | null | undefined): number | null {
  if (!raw) {
    return null
  }
  const iso = SQLITE_UTC_TIMESTAMP_RE.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const StartOptionsSchema = z
  .object({
    agent: z.unknown().optional(),
    model: z.unknown().optional(),
    account: z.unknown().optional(),
    launch: z
      .object({
        agent: z.unknown().optional(),
        model: z.unknown().optional(),
        account: z.unknown().optional(),
        accountLabel: z.unknown().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

function parseStartOptions(raw: string | null): ParsedStartOptions {
  if (!raw) {
    return { agent: null, model: null, account: null }
  }
  try {
    const parsed = StartOptionsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return { agent: null, model: null, account: null }
    }
    const { agent, model, account, launch } = parsed.data
    return {
      agent: readNonEmptyString(agent) ?? readNonEmptyString(launch?.agent),
      model: readNonEmptyString(model) ?? readNonEmptyString(launch?.model),
      account:
        readNonEmptyString(account) ??
        readNonEmptyString(launch?.account) ??
        readNonEmptyString(launch?.accountLabel)
    }
  } catch {
    return { agent: null, model: null, account: null }
  }
}

function normalizePriorAgentKey(agent: string | null): string | null {
  if (!agent) {
    return null
  }
  const lowered = agent.trim().toLowerCase()
  if (!lowered) {
    return null
  }
  if (lowered === 'claude-agent-teams') {
    return 'claude'
  }
  if (lowered === 'opencode2') {
    return 'opencode'
  }
  return lowered
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

function buildDurationPrior(agent: string, samples: readonly number[]): AgentDurationPrior | null {
  if (samples.length === 0) {
    return null
  }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    agent,
    sampleCount: sorted.length,
    medianMs: Math.round(percentile(sorted, 0.5)),
    p75Ms: Math.round(percentile(sorted, 0.75))
  }
}

const ACTIVE_AND_RECENT_WORKERS_SQL = `
  SELECT d.id AS dispatch_id,
         d.run_id AS run_id,
         d.task_id AS task_id,
         t.task_title AS task_title,
         t.display_name AS display_name,
         r.objective AS objective,
         COALESCE(w.state, d.status) AS worker_state,
         w.stage AS worker_stage,
         d.status AS dispatch_status,
         COALESCE(tr.pane_key, d.assignee_pane_key) AS pane_key,
         COALESCE(w.worktree_id, tr.worktree_id) AS worktree_id,
         COALESCE(w.agent_terminal_handle, d.assignee_handle) AS terminal_handle,
         w.start_options AS start_options,
         COALESCE(d.dispatched_at, w.created_at, d.created_at) AS started_at,
         COALESCE(d.last_heartbeat_at, w.updated_at, d.completed_at, d.created_at) AS updated_at,
         d.completed_at AS completed_at,
         COALESCE(w.last_error, d.last_failure) AS last_error,
         (
           SELECT COUNT(*)
             FROM messages m
            WHERE m.run_id = d.run_id
              AND (
                m.from_handle = 'dispatch:' || d.id
                OR m.to_handle = 'dispatch:' || d.id
                OR (
                  COALESCE(w.agent_terminal_handle, d.assignee_handle) IS NOT NULL
                  AND (
                    m.from_handle = COALESCE(w.agent_terminal_handle, d.assignee_handle)
                    OR m.to_handle = COALESCE(w.agent_terminal_handle, d.assignee_handle)
                  )
                )
              )
         ) AS message_count
    FROM dispatch_contexts d
    LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
    LEFT JOIN tasks t ON t.id = d.task_id AND t.run_id = d.run_id
    LEFT JOIN runs r ON r.id = d.run_id
    LEFT JOIN worker_terminal_resources tr ON tr.owner_dispatch_id = d.id
   WHERE d.status IN ('pending', 'dispatched')
      OR w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
      OR COALESCE(d.completed_at, w.updated_at, d.created_at) >= ?
   ORDER BY
     CASE
       WHEN d.status IN ('pending', 'dispatched')
         OR w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
       THEN 0
       ELSE 1
     END ASC,
     d.rowid DESC
   LIMIT ?
`

const COMPLETED_DURATION_SAMPLES_SQL = `
  SELECT w.start_options AS start_options,
         COALESCE(d.dispatched_at, w.created_at, d.created_at) AS started_at,
         d.completed_at AS completed_at
    FROM dispatch_contexts d
    LEFT JOIN worker_dispatches w ON w.dispatch_id = d.id
   WHERE d.status = 'completed'
     AND d.completed_at IS NOT NULL
     AND COALESCE(d.dispatched_at, w.created_at, d.created_at) IS NOT NULL
   ORDER BY d.rowid DESC
   LIMIT ?
`

export function queryBackgroundTasksSnapshot(
  runtime: OrcaRuntimeService,
  options?: { recentMinutes?: number; nowMs?: number }
): BackgroundTasksSnapshot {
  const fetchedAt = options?.nowMs ?? Date.now()
  const recentMinutes = options?.recentMinutes ?? DEFAULT_RECENT_MINUTES
  const db = runtime.getExistingOrchestrationDb()
  if (!db) {
    return {
      workers: [],
      priorsByAgent: {},
      globalPrior: null,
      fetchedAt
    }
  }

  const cutoffUtc = toSqliteUtcTimestamp(fetchedAt - recentMinutes * 60_000)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: column aliases in ACTIVE_AND_RECENT_WORKERS_SQL match RawWorkerRow.
  const rawWorkers = db.db
    .prepare(ACTIVE_AND_RECENT_WORKERS_SQL)
    .all(cutoffUtc, MAX_WORKER_ROWS) as RawWorkerRow[]

  const workers: BackgroundTaskWorkerRecord[] = rawWorkers.map((row) => {
    const startOpts = parseStartOptions(row.start_options)
    const startedAt = parseTimestampMs(row.started_at) ?? fetchedAt
    const updatedAt = parseTimestampMs(row.updated_at) ?? startedAt
    const completedAt = parseTimestampMs(row.completed_at)
    return {
      dispatchId: row.dispatch_id,
      runId: row.run_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      displayName: row.display_name,
      objective: row.objective,
      agent: startOpts.agent,
      model: startOpts.model,
      account: startOpts.account,
      state: row.worker_state ?? row.dispatch_status,
      stage: row.worker_stage,
      dispatchStatus: row.dispatch_status,
      paneKey: row.pane_key,
      worktreeId: row.worktree_id,
      terminalHandle: row.terminal_handle,
      startedAt,
      updatedAt,
      completedAt,
      lastError: row.last_error,
      messageCount: typeof row.message_count === 'number' ? row.message_count : 0
    }
  })

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: column aliases in COMPLETED_DURATION_SAMPLES_SQL match RawCompletedDurationRow.
  const rawSamples = db.db
    .prepare(COMPLETED_DURATION_SAMPLES_SQL)
    .all(MAX_PRIOR_ROWS) as RawCompletedDurationRow[]

  const globalSamples: number[] = []
  const samplesByAgent = new Map<string, number[]>()

  for (const row of rawSamples) {
    const startMs = parseTimestampMs(row.started_at)
    const endMs = parseTimestampMs(row.completed_at)
    if (startMs === null || endMs === null || endMs <= startMs) {
      continue
    }
    const durationMs = endMs - startMs
    if (durationMs < MIN_DURATION_SAMPLE_MS || durationMs > MAX_DURATION_SAMPLE_MS) {
      continue
    }
    globalSamples.push(durationMs)
    const agentKey = normalizePriorAgentKey(parseStartOptions(row.start_options).agent)
    if (agentKey) {
      const list = samplesByAgent.get(agentKey)
      if (list) {
        list.push(durationMs)
      } else {
        samplesByAgent.set(agentKey, [durationMs])
      }
    }
  }

  const priorsByAgent: Record<string, AgentDurationPrior> = {}
  for (const [agent, samples] of samplesByAgent) {
    const prior = buildDurationPrior(agent, samples)
    if (prior) {
      priorsByAgent[agent] = prior
    }
  }

  return {
    workers,
    priorsByAgent,
    globalPrior: buildDurationPrior('all', globalSamples),
    fetchedAt
  }
}
