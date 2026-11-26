/**
 * Fork (§16): WhatsApp Multi-Device Baileys adapter (QR login, Self-Chat, broadcast block & loop guard).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  WA_AUTH_DIR,
  activeThreads,
  channelStats,
  chunkMessage,
  dispatchAskToOrca,
  loadConfig,
  loadPairing,
  pushDelivery,
  sentWhatsAppIds,
  transcribeAudioBuffer
} from './openclaw-bridge-dispatch.mjs'

const INVISIBLE_CHARS_RE = /[\u200b\u2060\u2063\ufeff]/g
const ODD_SPACE_RE = /[\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]/g
const WA_SELF_PREFIX = '🦞 *Orca*\n'

let waSock = null
let waConnecting = false

export function isWhatsAppConnected() {
  return Boolean(waSock)
}

function normalizeWaJid(jid) {
  if (!jid) {
    return ''
  }
  return String(jid)
    .trim()
    .replace(/:\d+(?=@)/, '')
}

function isBroadcastJid(jid) {
  const lower = String(jid || '')
    .trim()
    .toLowerCase()
  return (
    lower === 'status@broadcast' || lower.endsWith('@broadcast') || lower.endsWith('@newsletter')
  )
}

function sanitizeWaOutbound(text) {
  return String(text || '')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(ODD_SPACE_RE, ' ')
    .replace(/^#{1,4}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
}

export async function sendWhatsAppMessage(targetJid, text, isSelfChat = false) {
  if (!waSock) {
    throw new Error('WhatsApp is not connected')
  }
  const clean = sanitizeWaOutbound(text)
  const pages = chunkMessage(clean, 3800)
  for (const page of pages) {
    const body = isSelfChat ? `${WA_SELF_PREFIX}${page}` : page
    const sent = await waSock.sendMessage(targetJid, { text: body })
    if (sent?.key?.id) {
      sentWhatsAppIds.add(sent.key.id)
      if (sentWhatsAppIds.size > 500) {
        const oldest = sentWhatsAppIds.values().next().value
        if (oldest) {
          sentWhatsAppIds.delete(oldest)
        }
      }
    }
  }
  channelStats.whatsapp.lastOutboundAt = Date.now()
}

export async function logoutWhatsAppConnection() {
  if (waSock) {
    await waSock.logout().catch(() => {})
    waSock = null
  }
  fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true })
  channelStats.whatsapp.state = 'unconfigured'
  channelStats.whatsapp.selfJid = null
  channelStats.whatsapp.qrDataUrl = null
  channelStats.whatsapp.qrAscii = null
  channelStats.whatsapp.detail = 'Logged out'
}

export async function startWhatsAppConnection(forceQr = false) {
  if (waConnecting) {
    return
  }
  const cfg = loadConfig()
  const hasCreds = fs.existsSync(path.join(WA_AUTH_DIR, 'creds.json'))
  if (!cfg.whatsappEnabled) {
    channelStats.whatsapp.state = 'offline'
    channelStats.whatsapp.detail = 'Disabled in config'
    return
  }
  if (!hasCreds && !forceQr) {
    channelStats.whatsapp.state = 'unconfigured'
    channelStats.whatsapp.detail = 'Run `orca ecosystem whatsapp login` or click Pair WhatsApp QR'
    return
  }
  waConnecting = true
  try {
    const baileys = await import('@whiskeysockets/baileys')
    const qrcodeMod = await import('qrcode').catch(() => null)
    const pinoMod = await import('pino').catch(() => null)
    const makeWASocket = baileys.default?.default || baileys.makeWASocket || baileys.default
    const loadMultiFileAuthState = baileys.useMultiFileAuthState
    const { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = baileys

    fs.mkdirSync(WA_AUTH_DIR, { recursive: true, mode: 0o700 })
    const { state, saveCreds } = await loadMultiFileAuthState(WA_AUTH_DIR)
    const versionInfo = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
    const logger = pinoMod?.default ? pinoMod.default({ level: 'silent' }) : undefined

    if (waSock) {
      try {
        waSock.end(undefined)
      } catch {
        // Ignore old socket close error
      }
    }

    waSock = makeWASocket({
      auth: state,
      ...(versionInfo?.version ? { version: versionInfo.version } : {}),
      ...(logger ? { logger } : {}),
      printQRInTerminal: false,
      browser: ['Orca Unified Ecosystem', 'macOS', '1.0.0'],
      markOnlineOnConnect: false
    })

    waSock.ev.on('creds.update', saveCreds)

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        channelStats.whatsapp.state = 'pairing'
        channelStats.whatsapp.detail = 'Scan QR code in WhatsApp → Linked Devices'
        if (qrcodeMod?.toDataURL) {
          channelStats.whatsapp.qrDataUrl = await qrcodeMod
            .toDataURL(qr, { margin: 1, width: 260 })
            .catch(() => null)
          channelStats.whatsapp.qrAscii = await qrcodeMod
            .toString(qr, { type: 'terminal', small: true })
            .catch(() => null)
        }
      }
      if (connection === 'open') {
        channelStats.whatsapp.qrDataUrl = null
        channelStats.whatsapp.qrAscii = null
        const selfId = normalizeWaJid(waSock?.user?.id)
        channelStats.whatsapp.selfJid = selfId || null
        channelStats.whatsapp.state = 'online'
        channelStats.whatsapp.detail = selfId ? `Connected (${selfId})` : 'Connected'
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const loggedOut = statusCode === DisconnectReason?.loggedOut
        waSock = null
        if (loggedOut) {
          fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true })
          channelStats.whatsapp.state = 'unconfigured'
          channelStats.whatsapp.detail = 'Logged out — pair QR again to reconnect'
        } else {
          channelStats.whatsapp.state = 'degraded'
          channelStats.whatsapp.detail = 'Reconnecting to WhatsApp…'
          setTimeout(() => {
            waConnecting = false
            startWhatsAppConnection(false).catch(() => {})
          }, 5000)
          return
        }
      }
      waConnecting = false
    })

    waSock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !Array.isArray(messages)) {
        return
      }
      for (const m of messages) {
        try {
          if (!m?.message || !m.key?.remoteJid) {
            continue
          }
          const remoteJid = m.key.remoteJid
          if (isBroadcastJid(remoteJid)) {
            continue
          }
          if (m.key.id && sentWhatsAppIds.has(m.key.id)) {
            continue
          }

          const selfIds = new Set(
            [normalizeWaJid(waSock?.user?.id), normalizeWaJid(waSock?.user?.lid)].filter(Boolean)
          )
          const normRemote = normalizeWaJid(remoteJid)
          const isSelfChat = Boolean(m.key.fromMe && selfIds.has(normRemote))

          let text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            m.message.imageMessage?.caption ||
            m.message.documentMessage?.caption ||
            ''
          if (String(text).startsWith(WA_SELF_PREFIX.trim())) {
            continue
          }
          if (m.key.fromMe && !isSelfChat) {
            continue
          }

          const liveCfg = loadConfig()
          const pairing = loadPairing()
          const allowSet = new Set(
            [...liveCfg.whatsappAllowFrom, ...pairing.approvedWhatsapp].map(normalizeWaJid)
          )
          if (!isSelfChat && !allowSet.has(normRemote)) {
            continue
          }

          if (m.message.audioMessage && downloadMediaMessage) {
            const buf = await downloadMediaMessage(m, 'buffer', {})
            const transcript = await transcribeAudioBuffer(Buffer.from(buf), '.ogg')
            if (transcript) {
              text = text ? `${String(text)}\n[Voice note]: ${transcript}` : transcript
            }
          }

          text = String(text || '').trim()
          if (!text) {
            continue
          }

          channelStats.whatsapp.lastInboundAt = Date.now()
          activeThreads.whatsapp.add(normRemote)
          pushDelivery('whatsapp', isSelfChat ? 'Self-Chat' : normRemote, text, 'accepted')

          await waSock.sendMessage(remoteJid, { react: { text: '👀', key: m.key } }).catch(() => {})
          await waSock.sendPresenceUpdate('composing', remoteJid).catch(() => {})

          const promptToRun = text.startsWith('/review')
            ? `Run an independent senior code & security review. ${text.replace(/^\/review\s*/, '')}`
            : text.startsWith('/rikugan ')
              ? `Using Rikugan, answer: ${text.replace(/^\/rikugan\s+/, '')}`
              : text

          const answer = await dispatchAskToOrca({
            prompt: promptToRun,
            source: 'whatsapp',
            externalId: `wa:${normRemote}`,
            senderName: isSelfChat ? 'Owner (WhatsApp Self)' : normRemote,
            wait: true
          })

          const replyText =
            answer?.reply ||
            (answer?.accepted
              ? '✅ Dispatched to Orca on your Mac.'
              : `⚠️ ${String(answer?.error || 'Orca unavailable.')}`)
          await sendWhatsAppMessage(remoteJid, replyText, isSelfChat)
          await waSock.sendMessage(remoteJid, { react: { text: '✅', key: m.key } }).catch(() => {})
          await waSock.sendPresenceUpdate('paused', remoteJid).catch(() => {})
        } catch (err) {
          console.error('[whatsapp] message error:', err)
        }
      }
    })
  } catch (err) {
    waConnecting = false
    channelStats.whatsapp.state = 'degraded'
    channelStats.whatsapp.detail = `WhatsApp init error: ${String(err?.message || err).slice(0, 90)}`
  }
}
