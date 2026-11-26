import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  EcosystemChannelStatusSchema,
  type EcosystemChannelStatus
} from '../../shared/ecosystem/ecosystem-types'
import {
  ecosystemPaths,
  readEcosystemConfig,
  readEcosystemSecrets,
  readPairingStore
} from './ecosystem-config'

export {
  ensureBridgeRuntimeDeps,
  parkLegacyHermesGateway,
  startOpenClawBridgeDaemon,
  stopOpenClawBridgeDaemon
} from './openclaw-bridge-daemon'

/** Fork: OpenClaw channel & multimodal bridge HTTP client & status probe (§16). */

const BridgeStatusResponseSchema = z.object({
  ok: z.boolean(),
  pid: z.number().int().nullable().optional(),
  channels: z.array(EcosystemChannelStatusSchema).optional(),
  recentDeliveries: z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        sender: z.string(),
        preview: z.string(),
        at: z.number(),
        status: z.string()
      })
    )
    .optional()
})

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

export async function callBridgeJson(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number
    home?: string
  } = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const home = options.home ?? homedir()
  const [cfg, secrets] = await Promise.all([readEcosystemConfig(home), readEcosystemSecrets(home)])
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_500)
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.bridgePort}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${secrets.ORCA_ECOSYSTEM_TOKEN ?? ''}`,
        'Content-Type': 'application/json'
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }
  } catch {
    return { ok: false, status: 0, data: null }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeOpenClawBridgeStatus(home: string = homedir()): Promise<{
  running: boolean
  pid: number | null
  port: number
  channels: EcosystemChannelStatus[]
  recentDeliveries: {
    id: string
    source: string
    sender: string
    preview: string
    at: number
    status: string
  }[]
}> {
  const [cfg, secrets, pairing] = await Promise.all([
    readEcosystemConfig(home),
    readEcosystemSecrets(home),
    readPairingStore(home)
  ])
  const res = await callBridgeJson('/v1/status', { timeoutMs: 1_800, home })
  if (res.ok) {
    const parsed = BridgeStatusResponseSchema.safeParse(res.data)
    if (parsed.success && parsed.data.channels) {
      return {
        running: true,
        pid: parsed.data.pid ?? null,
        port: cfg.bridgePort,
        channels: parsed.data.channels,
        recentDeliveries: parsed.data.recentDeliveries ?? []
      }
    }
  }
  const waCredsExist = await pathExists(join(ecosystemPaths(home).whatsappAuthDir, 'creds.json'))
  const hasTgToken = Boolean(secrets.TELEGRAM_BOT_TOKEN)
  return {
    running: false,
    pid: null,
    port: cfg.bridgePort,
    channels: [
      {
        id: 'telegram',
        label: 'Telegram',
        enabled: cfg.telegramEnabled,
        state: hasTgToken ? 'offline' : 'unconfigured',
        detail: hasTgToken
          ? 'Bridge stopped — run `orca ecosystem up`'
          : 'Set TELEGRAM_BOT_TOKEN in Ecosystem Hub or ~/.config/orca-ecosystem/.env',
        allowlistCount: new Set([...cfg.telegramAllowFrom, ...pairing.approvedTelegram]).size,
        activeThreads: 0,
        lastInboundAt: null,
        lastOutboundAt: null,
        botUsername: null
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        enabled: cfg.whatsappEnabled,
        state: waCredsExist ? 'offline' : 'unconfigured',
        detail: waCredsExist
          ? 'Linked credentials ready — run `orca ecosystem up`'
          : 'Pair via `orca ecosystem whatsapp login` (QR scan)',
        allowlistCount: new Set([...cfg.whatsappAllowFrom, ...pairing.approvedWhatsapp]).size,
        activeThreads: 0,
        lastInboundAt: null,
        lastOutboundAt: null,
        selfJid: null
      },
      {
        id: 'http',
        label: 'Unified HTTP & Webhooks',
        enabled: true,
        state: 'offline',
        detail: `127.0.0.1:${cfg.bridgePort}/v1/ask & /webhooks/:hookName (stopped)`,
        allowlistCount: 1,
        activeThreads: 0,
        lastInboundAt: null,
        lastOutboundAt: null
      }
    ],
    recentDeliveries: []
  }
}
