import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import type {
  EcosystemAskResult,
  EcosystemLearnResult,
  EcosystemStatusSnapshot
} from '../../shared/ecosystem/ecosystem-types'

/** Fork: CLI handlers for `orca ecosystem ...` (§16). */

export function formatEcosystemStatus(snap: EcosystemStatusSnapshot): string {
  const lines = [
    `Orca Unified Ecosystem (${snap.macStandaloneReady ? 'Mac-Standalone Ready' : 'Needs Setup'})`,
    `  Runtime Dir:   ${snap.runtimeDir}`,
    `  Primary Bot:   ${snap.primaryBotName ?? 'None (Bots disabled or none created)'}`,
    `  HTTP/Webhook:  http://127.0.0.1:${snap.bridgePort}/v1/ask [${snap.bridgeRunning ? `online, pid ${snap.bridgePid ?? '?'}` : 'stopped'}]`,
    '',
    `Rikugan Brain (${snap.rikugan.url})`,
    `  State:         ${snap.rikugan.state} — ${snap.rikugan.detail}`,
    `  Embeddings:    ${snap.rikugan.embeddedChunks !== null ? `${snap.rikugan.embeddedChunks.toLocaleString()} vectors` : 'unknown'} (${snap.rikugan.semanticReady ? 'semantic+FTS5' : 'FTS5 only'})`,
    '',
    `Hermes Intelligence Suite`,
    `  State:         ${snap.hermes.state} — ${snap.hermes.detail}`,
    `  Auto-Learn:    ${snap.hermes.autoLearnEnabled ? 'enabled (with skill-scanner & Undo)' : 'paused'} · Legacy daemon parked: ${snap.hermes.legacyGatewayParked ? 'yes' : 'NO (running)'}`,
    '',
    `OpenClaw Channels`
  ]
  for (const ch of snap.channels) {
    lines.push(
      `  • ${ch.label.padEnd(24)} [${ch.state}] ${ch.detail} (allowlist: ${ch.allowlistCount}, active: ${ch.activeThreads})`
    )
  }
  if (snap.pendingPairings.length > 0) {
    lines.push('', 'Pending Pairing Codes:')
    for (const p of snap.pendingPairings) {
      lines.push(
        `  • ${p.code} (${p.channel}) from ${p.senderName ?? p.senderId} -> approve with: orca ecosystem pair --code ${p.code}`
      )
    }
  }
  return lines.join('\n')
}

export const ECOSYSTEM_HANDLERS: Record<string, CommandHandler> = {
  'ecosystem up': async ({ client, json }) => {
    const res = await client.call<{ ok: boolean; detail: string; status: EcosystemStatusSnapshot }>(
      'delegation.ecosystemControl',
      { action: 'up' }
    )
    printResult(res, json, (v) => `${v.detail}\n\n${formatEcosystemStatus(v.status)}`)
  },
  'ecosystem down': async ({ client, json }) => {
    const res = await client.call<{ ok: boolean; detail: string; status: EcosystemStatusSnapshot }>(
      'delegation.ecosystemControl',
      { action: 'down' }
    )
    printResult(res, json, (v) => v.detail)
  },
  'ecosystem status': async ({ client, json }) => {
    const res = await client.call<EcosystemStatusSnapshot>('delegation.ecosystemStatus', {})
    printResult(res, json, formatEcosystemStatus)
  },
  'ecosystem sync': async ({ client, json }) => {
    const res = await client.call<{ ok: boolean; detail: string; status: EcosystemStatusSnapshot }>(
      'delegation.ecosystemControl',
      { action: 'sync' }
    )
    printResult(res, json, (v) => v.detail)
  },
  'ecosystem ask': async ({ client, flags, json }) => {
    const prompt = getRequiredStringFlag(flags, 'prompt')
    const source = getOptionalStringFlag(flags, 'source')
    const externalId = getOptionalStringFlag(flags, 'thread')
    const senderName = getOptionalStringFlag(flags, 'sender')
    const agent = getOptionalStringFlag(flags, 'agent')
    const wait = flags.has('wait')
    const res = await client.call<EcosystemAskResult>('delegation.ecosystemAsk', {
      prompt,
      ...(source ? { source } : {}),
      ...(externalId ? { externalId } : {}),
      ...(senderName ? { senderName } : {}),
      ...(agent ? { agent } : {}),
      wait
    })
    if (!res.result.accepted) {
      process.exitCode = 1
    }
    printResult(res, json, (v) =>
      v.reply
        ? v.reply
        : v.accepted
          ? `Dispatched to Orca session ${v.sessionId ?? 'orca-hq'} (${v.rikuganItemsAttached} Rikugan items attached).`
          : `Failed: ${v.error ?? 'unknown error'}`
    )
  },
  'ecosystem review': async ({ client, flags, json }) => {
    const focus = getOptionalStringFlag(flags, 'focus')
    const res = await client.call<EcosystemLearnResult>('delegation.ecosystemLearn', {
      mode: 'review',
      ...(focus ? { focus } : {})
    })
    printResult(res, json, (v) => v.summary)
  },
  'ecosystem learn': async ({ client, flags, json }) => {
    const topic = getRequiredStringFlag(flags, 'topic')
    const res = await client.call<EcosystemLearnResult>('delegation.ecosystemLearn', {
      mode: 'learn',
      topic
    })
    if (!res.result.ok) {
      process.exitCode = 1
    }
    printResult(res, json, (v) => v.summary)
  },
  'ecosystem undo-skill': async ({ client, flags, json }) => {
    const skillName = getRequiredStringFlag(flags, 'skill')
    const res = await client.call<{ ok: boolean; detail: string }>('delegation.ecosystemControl', {
      action: 'undo-skill',
      skillName
    })
    printResult(res, json, (v) => v.detail)
  },
  'ecosystem skills': async ({ client, flags, json }) => {
    const install = getOptionalStringFlag(flags, 'install')
    const search = getOptionalStringFlag(flags, 'search')
    const res = await client.call<EcosystemLearnResult>('delegation.ecosystemLearn', {
      mode: install ? 'skills-install' : 'skills-search',
      query: install ?? search ?? ''
    })
    printResult(res, json, (v) => {
      if (!v.items?.length) {
        return v.summary
      }
      return [
        v.summary,
        ...v.items.map((item) => `  • ${item.name} [${item.source}] — ${item.description}`)
      ].join('\n')
    })
  },
  'ecosystem pair': async ({ client, flags, json }) => {
    const code = getRequiredStringFlag(flags, 'code')
    const res = await client.call<{ ok: boolean; detail: string }>('delegation.ecosystemControl', {
      action: 'approve-pairing',
      code
    })
    printResult(res, json, (v) => v.detail)
  },
  'ecosystem telegram': async ({ client, flags, json }) => {
    const token = getRequiredStringFlag(flags, 'token')
    const res = await client.call<{ ok: boolean; detail: string }>('delegation.ecosystemControl', {
      action: 'set-telegram-token',
      token
    })
    printResult(res, json, (v) => v.detail)
  },
  'ecosystem whatsapp': async ({ client, flags, json }) => {
    const logout = flags.has('logout')
    const res = await client.call<{
      ok: boolean
      detail: string
      status: EcosystemStatusSnapshot
      extra?: Record<string, unknown>
    }>('delegation.ecosystemControl', {
      action: logout ? 'whatsapp-logout' : 'whatsapp-login'
    })
    printResult(res, json, (v) => {
      const wa = v.status.channels.find((c) => c.id === 'whatsapp')
      const ascii = typeof v.extra?.qrAscii === 'string' ? v.extra.qrAscii : (wa?.qrAscii ?? null)
      return ascii ? `${v.detail}\n\n${ascii}` : `${v.detail} (${wa?.detail ?? ''})`
    })
  },
  'ecosystem notify': async ({ client, flags, json }) => {
    const message = getRequiredStringFlag(flags, 'message')
    const ch = getOptionalStringFlag(flags, 'channel')
    const channel = ch === 'telegram' || ch === 'whatsapp' ? ch : 'auto'
    const res = await client.call<{ ok: boolean; detail: string }>('delegation.ecosystemControl', {
      action: 'notify',
      message,
      channel
    })
    printResult(res, json, (v) => v.detail)
  }
}
