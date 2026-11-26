import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type {
  EcosystemControlAction,
  EcosystemStatusSnapshot
} from '../../shared/ecosystem/ecosystem-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  approvePairingCode,
  ecosystemPaths,
  readEcosystemConfig,
  readPairingStore,
  setEcosystemSecret,
  stageStandaloneEcosystemRuntime,
  writeEcosystemConfig
} from './ecosystem-config'
import { probeHermesSuiteStatus, undoLearnedSkill } from './hermes-learning-connector'
import {
  callBridgeJson,
  parkLegacyHermesGateway,
  probeOpenClawBridgeStatus,
  startOpenClawBridgeDaemon,
  stopOpenClawBridgeDaemon
} from './openclaw-connector'
import { ensureRikuganRunning, ensureRikuganToken, probeRikuganStatus } from './rikugan-connector'

/** Fork: unified Ecosystem status & lifecycle supervisor across Rikugan, Hermes, and OpenClaw (§16). */

const DEFAULT_REPO_ROOT = '/Volumes/ssd_thunder_apfs/MainCodeBase/OpenSourceGit/orca'

const ORCA_HQ_SEED =
  'Primary unified coordinator for the owner across Mac, Android, Telegram, and WhatsApp. ' +
  'Use Rikugan (`mcp__rikugan__*`) for personal/app facts and session continuity, `orca_ptc` for ' +
  'multi-step Python/RPC pipelines, and external MCPs (`dusk`, `browser-use`, `background-computer-use`) for web/GUI actions.'

export async function ensurePrimaryEcosystemBot(runtime: OrcaRuntimeService) {
  if (!runtime.bots.enabled()) {
    return null
  }
  const existing = runtime.bots.list()
  const named = existing.find((b) => b.name.toLowerCase() === 'orca hq' || b.folder === 'orca-hq')
  if (named) {
    return named
  }
  if (existing.length > 0) {
    return existing[0] ?? null
  }
  return runtime.bots
    .create({ name: 'Orca HQ', agent: 'claude', seed: { purpose: ORCA_HQ_SEED } })
    .catch(() => null)
}

export async function readEcosystemStatus(
  runtime: OrcaRuntimeService,
  home: string = homedir()
): Promise<EcosystemStatusSnapshot> {
  const paths = ecosystemPaths(home)
  const [rikugan, hermes, bridge, pairing, bridgeRuntimePresent] = await Promise.all([
    probeRikuganStatus(home),
    probeHermesSuiteStatus(home),
    probeOpenClawBridgeStatus(home),
    readPairingStore(home),
    stat(join(paths.runtimeDir, 'orca-openclaw-bridge.mjs')).then(
      () => true,
      () => false
    )
  ])
  const bots = runtime.bots.enabled() ? runtime.bots.list() : []
  const primary = bots.find((b) => b.name.toLowerCase() === 'orca hq') ?? bots[0] ?? null
  return {
    checkedAt: Date.now(),
    macStandaloneReady: bridgeRuntimePresent && rikugan.state !== 'offline',
    runtimeDir: paths.runtimeDir,
    bridgePort: bridge.port,
    bridgeRunning: bridge.running,
    bridgePid: bridge.pid,
    primaryBotId: primary?.id ?? null,
    primaryBotName: primary?.name ?? null,
    rikugan,
    hermes,
    channels: bridge.channels,
    pendingPairings: pairing.pending,
    recentDeliveries: bridge.recentDeliveries
  }
}

export async function syncCrossCliEcosystemMcp(
  repoRoot: string = DEFAULT_REPO_ROOT,
  home: string = homedir()
): Promise<void> {
  await stageStandaloneEcosystemRuntime(repoRoot, home)
  const installer = join(repoRoot, 'fork', 'scripts', 'install-browser-use-mcp.mjs')
  const hasInstaller = await stat(installer).then(
    () => true,
    () => false
  )
  if (!hasInstaller) {
    return
  }
  await runProcess({
    program: process.execPath,
    args: [installer, '--home', home],
    timeoutMs: 25_000,
    maxOutputBytes: 16_384
  }).catch(() => null)
}

export async function controlEcosystem(
  runtime: OrcaRuntimeService,
  input: {
    action: EcosystemControlAction
    code?: string
    token?: string
    skillName?: string
    message?: string
    channel?: 'auto' | 'telegram' | 'whatsapp'
    enabled?: boolean
  },
  home: string = homedir()
): Promise<{
  ok: boolean
  detail: string
  status: EcosystemStatusSnapshot
  extra?: Record<string, unknown>
}> {
  let detail = 'Updated ecosystem state.'
  let extra: Record<string, unknown> | undefined
  switch (input.action) {
    case 'up': {
      await ensureRikuganRunning(home)
      await ensureRikuganToken(home)
      await syncCrossCliEcosystemMcp(DEFAULT_REPO_ROOT, home)
      await parkLegacyHermesGateway()
      const bridgeRes = await startOpenClawBridgeDaemon(DEFAULT_REPO_ROOT, home)
      await ensurePrimaryEcosystemBot(runtime)
      detail = bridgeRes.detail
      break
    }
    case 'down': {
      await stopOpenClawBridgeDaemon(home)
      detail = 'Stopped local OpenClaw channel & HTTP bridge.'
      break
    }
    case 'sync': {
      await ensureRikuganToken(home)
      await syncCrossCliEcosystemMcp(DEFAULT_REPO_ROOT, home)
      detail = 'Synced Rikugan, Orca-Hermes PTC, and browser MCPs across all 6 CLIs.'
      break
    }
    case 'approve-pairing': {
      const approved = await approvePairingCode(input.code ?? '', home)
      detail = approved
        ? `Approved ${approved.channel} sender ${approved.senderName ?? approved.senderId}.`
        : `No pending pairing code '${input.code ?? ''}'.`
      break
    }
    case 'set-telegram-token': {
      await setEcosystemSecret('TELEGRAM_BOT_TOKEN', input.token ?? '', home)
      detail = input.token?.trim()
        ? 'Saved TELEGRAM_BOT_TOKEN (0600) in ~/.config/orca-ecosystem/.env.'
        : 'Cleared TELEGRAM_BOT_TOKEN.'
      break
    }
    case 'whatsapp-login': {
      await startOpenClawBridgeDaemon(DEFAULT_REPO_ROOT, home)
      const qrRes = await callBridgeJson('/v1/whatsapp/login', {
        method: 'POST',
        timeoutMs: 6_000,
        home
      })
      if (qrRes.ok && typeof qrRes.data === 'object' && qrRes.data !== null) {
        extra = { ...qrRes.data }
      }
      detail = 'Initiated WhatsApp Web QR pairing.'
      break
    }
    case 'whatsapp-logout': {
      await callBridgeJson('/v1/whatsapp/logout', { method: 'POST', timeoutMs: 5_000, home })
      detail = 'Logged out WhatsApp session.'
      break
    }
    case 'toggle-auto-learn': {
      const current = await readEcosystemConfig(home)
      const next = input.enabled ?? !current.autoLearnEnabled
      await writeEcosystemConfig({ autoLearnEnabled: next }, home)
      detail = `Hermes background auto-learning ${next ? 'enabled' : 'paused'}.`
      break
    }
    case 'undo-skill': {
      const undone = await undoLearnedSkill(input.skillName ?? '', home)
      detail = undone.detail
      break
    }
    case 'notify': {
      const notifyRes = await callBridgeJson('/v1/notify', {
        method: 'POST',
        body: { message: input.message ?? '', channel: input.channel ?? 'auto' },
        timeoutMs: 10_000,
        home
      })
      detail = notifyRes.ok
        ? 'Delivered proactive notification.'
        : 'No active channel target to notify.'
      break
    }
    case 'park-hermes-gateway': {
      await parkLegacyHermesGateway()
      detail = 'Parked duplicate standalone ai.hermes.gateway daemon.'
      break
    }
  }
  const status = await readEcosystemStatus(runtime, home)
  return { ok: true, detail, status, ...(extra ? { extra } : {}) }
}
