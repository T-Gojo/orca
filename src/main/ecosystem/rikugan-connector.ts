import { homedir, userInfo } from 'node:os'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import type { EcosystemRikuganStatus } from '../../shared/ecosystem/ecosystem-types'
import { readEcosystemConfig, readEcosystemSecrets, setEcosystemSecret } from './ecosystem-config'
import {
  clipRikuganText,
  formatRikuganContextResult,
  getRikuganRuntimeCounters,
  getRikuganSessionState,
  incrementRecordedRikuganSessions,
  isPlainRecord,
  isTrivialRikuganPrompt,
  recordRikuganContextLatency,
  resetRikuganSessionStateForTests,
  scrubSecretsForRikugan
} from './rikugan-context-format'

export {
  formatRikuganContextResult,
  isTrivialRikuganPrompt,
  resetRikuganSessionStateForTests,
  scrubSecretsForRikugan
}

/** Fork: native Rikugan connector porting Hermes RikuganMemoryProvider into Orca (§16). */

const RikuganHealthSchema = z.object({
  ok: z.boolean().optional(),
  version: z.string().optional()
})

const RikuganStatsSchema = z.object({
  nodes: z.number().optional(),
  totalNodes: z.number().optional(),
  chunks: z.number().optional(),
  embedded: z.number().optional()
})

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    const data: unknown = text ? JSON.parse(text) : null
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  } finally {
    clearTimeout(timer)
  }
}

/** Mints a scoped `Orca Ecosystem` standard-tier token via Rikugan's loopback UI API if missing. */
export async function ensureRikuganToken(home: string = homedir()): Promise<string | null> {
  const secrets = await readEcosystemSecrets(home)
  if (secrets.RIKUGAN_TOKEN) {
    return secrets.RIKUGAN_TOKEN
  }
  const cfg = await readEcosystemConfig(home)
  const uiBase = cfg.rikuganUiUrl.replace(/\/+$/, '')
  const created = await fetchJsonWithTimeout(
    `${uiBase}/brain-api/access/tokens`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: uiBase },
      body: JSON.stringify({
        name: 'Orca Ecosystem',
        tier: 'standard',
        canWrite: true,
        expiresDays: 0
      })
    },
    4_000
  )
  if (!created.ok || !isPlainRecord(created.data) || typeof created.data.token !== 'string') {
    return null
  }
  const token = created.data.token
  const tokenId = typeof created.data.id === 'string' ? created.data.id : null
  if (tokenId) {
    for (const perm of ['brain.records.delete', 'brain.records.any']) {
      await fetchJsonWithTimeout(
        `${uiBase}/brain-api/permissions/set`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: uiBase },
          body: JSON.stringify({
            principal: `token:${tokenId}`,
            permission: perm,
            state: 'denied'
          })
        },
        3_000
      )
    }
  }
  await setEcosystemSecret('RIKUGAN_TOKEN', token, home)
  return token
}

export async function ensureRikuganRunning(home: string = homedir()): Promise<boolean> {
  const cfg = await readEcosystemConfig(home)
  const gwBase = cfg.rikuganUrl.replace(/\/+$/, '')
  const initial = await fetchJsonWithTimeout(`${gwBase}/healthz`, { method: 'GET' }, 1_800)
  if (initial.ok) {
    return true
  }
  if (process.platform === 'darwin') {
    const uid = userInfo().uid
    await runProcess({
      program: '/bin/launchctl',
      args: ['kickstart', '-k', `gui/${uid}/com.thunder.rikugan`],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096
    }).catch(() => null)
    const after = await fetchJsonWithTimeout(`${gwBase}/healthz`, { method: 'GET' }, 3_500)
    return after.ok
  }
  return false
}

export async function callRikuganTool(
  toolName: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number; home?: string } = {}
): Promise<unknown> {
  if (!/^[a-z_]{2,40}$/.test(toolName)) {
    throw new Error(`Invalid Rikugan tool name: ${toolName}`)
  }
  const home = options.home ?? homedir()
  const cfg = await readEcosystemConfig(home)
  const token = await ensureRikuganToken(home)
  if (!token) {
    return null
  }
  const gwBase = cfg.rikuganUrl.replace(/\/+$/, '')
  const res = await fetchJsonWithTimeout(
    `${gwBase}/v1/tools/${toolName}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'orca-ecosystem/1.0'
      },
      body: JSON.stringify(args)
    },
    options.timeoutMs ?? 4_000
  )
  return res.ok ? res.data : null
}

export async function prefetchRikuganContext(
  prompt: string,
  sessionId: string,
  options: { timeoutMs?: number; maxChars?: number; home?: string } = {}
): Promise<{ text: string; itemCount: number }> {
  if (isTrivialRikuganPrompt(prompt)) {
    return { text: '', itemCount: 0 }
  }
  const started = Date.now()
  const state = getRikuganSessionState(sessionId || 'default')
  const raw = await callRikuganTool(
    'get_context',
    { task: clipRikuganText(prompt, 500), limit: 8 },
    { timeoutMs: options.timeoutMs ?? 3_500, ...(options.home ? { home: options.home } : {}) }
  )
  recordRikuganContextLatency(Date.now() - started)
  const formatted = formatRikuganContextResult(raw, {
    includeBrief: !state.briefSent,
    seenIds: state.seenIds,
    ...(options.maxChars ? { maxChars: options.maxChars } : {})
  })
  if (formatted.text) {
    state.briefSent = true
  }
  return formatted
}

export async function recordCompletedSessionToRikugan(
  input: {
    sessionId: string
    title: string
    summary: string
    decisions?: string[]
    openThreads?: string[]
    outcome?: 'done' | 'partial' | 'blocked' | 'abandoned'
  },
  home: string = homedir()
): Promise<boolean> {
  const state = getRikuganSessionState(input.sessionId)
  state.turns += 1
  if (state.recorded || input.summary.trim().length < 24) {
    return false
  }
  const cleanSummary = scrubSecretsForRikugan(clipRikuganText(input.summary, 1_500))
  const cleanTitle = scrubSecretsForRikugan(clipRikuganText(input.title || 'Orca session', 96))
  const result = await callRikuganTool(
    'record_session',
    {
      title: cleanTitle,
      summary: cleanSummary,
      decisions: (input.decisions ?? [])
        .slice(0, 6)
        .map((d) => scrubSecretsForRikugan(clipRikuganText(d, 220))),
      openThreads: (input.openThreads ?? [])
        .slice(0, 6)
        .map((t) => scrubSecretsForRikugan(clipRikuganText(t, 220))),
      outcome: input.outcome ?? 'done'
    },
    { timeoutMs: 8_000, home }
  )
  if (result !== null) {
    state.recorded = true
    incrementRecordedRikuganSessions()
    return true
  }
  return false
}

export async function probeRikuganStatus(
  home: string = homedir()
): Promise<EcosystemRikuganStatus> {
  const [cfg, secrets] = await Promise.all([readEcosystemConfig(home), readEcosystemSecrets(home)])
  const gwBase = cfg.rikuganUrl.replace(/\/+$/, '')
  const uiBase = cfg.rikuganUiUrl.replace(/\/+$/, '')
  const [healthRes, statsRes] = await Promise.all([
    fetchJsonWithTimeout(`${gwBase}/healthz`, { method: 'GET' }, 2_000),
    fetchJsonWithTimeout(`${uiBase}/brain-api/stats`, { method: 'GET' }, 2_000)
  ])
  const health = RikuganHealthSchema.safeParse(healthRes.data)
  const stats = RikuganStatsSchema.safeParse(statsRes.data)
  const hasToken = Boolean(secrets.RIKUGAN_TOKEN)
  const counters = getRikuganRuntimeCounters()
  if (!healthRes.ok) {
    return {
      state: 'offline',
      url: gwBase,
      version: null,
      hasToken,
      totalNodes: null,
      embeddedChunks: null,
      semanticReady: false,
      recordedSessions: counters.recordedSessions,
      lastContextMs: counters.lastContextMs,
      detail: 'Rikugan gateway (:5680) is unreachable on Mac loopback.'
    }
  }
  const totalNodes = stats.success ? (stats.data.nodes ?? stats.data.totalNodes ?? null) : null
  const chunks = stats.success ? (stats.data.chunks ?? null) : null
  const embedded = stats.success ? (stats.data.embedded ?? null) : null
  const semanticReady = chunks !== null && embedded !== null ? embedded > 0 : true
  return {
    state: hasToken ? 'online' : 'degraded',
    url: gwBase,
    version: health.success ? (health.data.version ?? null) : null,
    hasToken,
    totalNodes,
    embeddedChunks: embedded,
    semanticReady,
    recordedSessions: counters.recordedSessions,
    lastContextMs: counters.lastContextMs,
    detail: hasToken
      ? `Connected on Mac SSD (${totalNodes !== null ? `${totalNodes.toLocaleString()} nodes` : 'ready'})`
      : 'Running on :5680 — token provisioning needed'
  }
}
