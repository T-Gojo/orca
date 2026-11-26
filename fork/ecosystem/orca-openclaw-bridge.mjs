#!/usr/bin/env node
/**
 * Fork (§16): Mac-standalone OpenClaw Channel, Multimodal & Webhook Bridge (`orca-openclaw-bridge.mjs`).
 * Runs from `~/.config/orca-ecosystem/runtime/` on `127.0.0.1:6770` (survives Thunder SSD removal!).
 */
import http from 'node:http'
import {
  activeThreads,
  channelStats,
  chunkMessage,
  constantTimeBearerOk,
  dispatchAskToOrca,
  issuePairingCode,
  loadConfig,
  loadPairing,
  loadSecrets,
  pushDelivery,
  recentDeliveries,
  transcribeAudioBuffer
} from './openclaw-bridge-dispatch.mjs'
import {
  isWhatsAppConnected,
  logoutWhatsAppConnection,
  sendWhatsAppMessage,
  startWhatsAppConnection
} from './openclaw-whatsapp-adapter.mjs'

let telegramRunning = false
let telegramOffset = 0

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${String(token)}/${String(method)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  return await res.json()
}

async function sendTelegramMessage(chatId, text, replyToMessageId = undefined) {
  const token = loadSecrets().TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set')
  }
  const pages = chunkMessage(text, 3950)
  let firstMsgId = null
  for (let i = 0; i < pages.length; i += 1) {
    const sent = await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: pages[i],
      ...(i === 0 && replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
    })
    if (i === 0 && sent?.result?.message_id) {
      firstMsgId = sent.result.message_id
    }
  }
  channelStats.telegram.lastOutboundAt = Date.now()
  return firstMsgId
}

async function handleTelegramUpdate(token, update) {
  if (update.callback_query) {
    const cb = update.callback_query
    await tgCall(token, 'answerCallbackQuery', {
      callback_query_id: cb.id,
      text: 'Forwarded to Orca'
    })
    return
  }
  const msg = update.message
  if (!msg || !msg.chat) {
    return
  }
  const chatId = String(msg.chat.id)
  const senderId = String(msg.from?.id || chatId)
  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
    msg.from?.username ||
    senderId

  const cfg = loadConfig()
  const pairing = loadPairing()
  const allowed = new Set([
    ...cfg.telegramAllowFrom.map(String),
    ...pairing.approvedTelegram.map(String)
  ])

  let text = String(msg.text || msg.caption || '').trim()

  if (!allowed.has(senderId) && !allowed.has(chatId)) {
    const code = issuePairingCode('telegram', senderId, senderName)
    pushDelivery('telegram', senderName, `Pairing requested (code ${code})`, 'pairing')
    await tgCall(token, 'sendMessage', {
      chat_id: msg.chat.id,
      text: `🔐 Orca Unified Ecosystem pairing required.\nApprove code \`${code}\` in Orca Desktop, Orca Mobile, or run:\n\norca ecosystem pair --code ${code}`,
      parse_mode: 'Markdown'
    })
    return
  }

  channelStats.telegram.lastInboundAt = Date.now()
  activeThreads.telegram.add(chatId)

  if (msg.voice?.file_id || msg.audio?.file_id) {
    const fileId = msg.voice?.file_id || msg.audio?.file_id
    const info = await tgCall(token, 'getFile', { file_id: fileId })
    if (info?.ok && info.result?.file_path) {
      const dl = await fetch(
        `https://api.telegram.org/file/bot${String(token)}/${String(info.result.file_path)}`
      )
      const buf = Buffer.from(await dl.arrayBuffer())
      const transcript = await transcribeAudioBuffer(buf, '.ogg')
      if (transcript) {
        text = text ? `${text}\n[Voice note]: ${transcript}` : transcript
      }
    }
  }

  if (!text) {
    return
  }
  pushDelivery('telegram', senderName, text, 'accepted')

  if (text === '/status') {
    await sendTelegramMessage(
      msg.chat.id,
      `🦞 Orca Unified Ecosystem Online\n• PID: ${String(process.pid)}\n• Telegram threads: ${String(activeThreads.telegram.size)}\n• WhatsApp: ${String(channelStats.whatsapp.state)}`,
      msg.message_id
    )
    return
  }

  await tgCall(token, 'sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => {})
  const draftRes = await tgCall(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text: '⏳ Working on your Mac via Orca…',
    reply_to_message_id: msg.message_id
  }).catch(() => null)
  const draftMsgId = draftRes?.result?.message_id

  const promptToRun = text.startsWith('/review')
    ? `Run an independent senior code & security review. ${text.replace(/^\/review\s*/, '')}`
    : text.startsWith('/rikugan ')
      ? `Using Rikugan, answer: ${text.replace(/^\/rikugan\s+/, '')}`
      : text

  const answer = await dispatchAskToOrca({
    prompt: promptToRun,
    source: 'telegram',
    externalId: `tg:${chatId}`,
    senderName,
    wait: true
  })

  const finalReply =
    answer?.reply ||
    (answer?.accepted
      ? '✅ Dispatched to Orca on your Mac.'
      : `⚠️ ${String(answer?.error || 'Could not reach Orca.')}`)
  const pages = chunkMessage(finalReply, 3950)
  if (draftMsgId) {
    await tgCall(token, 'editMessageText', {
      chat_id: msg.chat.id,
      message_id: draftMsgId,
      text: pages[0]
    }).catch(() => sendTelegramMessage(msg.chat.id, pages[0], msg.message_id))
    for (let i = 1; i < pages.length; i += 1) {
      await sendTelegramMessage(msg.chat.id, pages[i])
    }
    channelStats.telegram.lastOutboundAt = Date.now()
  } else {
    await sendTelegramMessage(msg.chat.id, finalReply, msg.message_id)
  }
}

async function startTelegramLoop() {
  if (telegramRunning) {
    return
  }
  telegramRunning = true
  while (telegramRunning) {
    const cfg = loadConfig()
    const token = loadSecrets().TELEGRAM_BOT_TOKEN
    if (!cfg.telegramEnabled || !token) {
      channelStats.telegram.state = token ? 'offline' : 'unconfigured'
      channelStats.telegram.detail = token ? 'Disabled in config' : 'Waiting for TELEGRAM_BOT_TOKEN'
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    try {
      if (!channelStats.telegram.botUsername) {
        const me = await tgCall(token, 'getMe', {})
        if (me?.ok && me.result?.username) {
          channelStats.telegram.botUsername = `@${String(me.result.username)}`
        } else if (!me?.ok) {
          channelStats.telegram.state = 'degraded'
          channelStats.telegram.detail = `Telegram token error: ${String(me?.description || 'invalid')}`
          await new Promise((r) => setTimeout(r, 10_000))
          continue
        }
      }
      channelStats.telegram.state = 'online'
      channelStats.telegram.detail = `Polling ${String(channelStats.telegram.botUsername || 'Telegram Bot')}`
      const updates = await tgCall(token, 'getUpdates', {
        offset: telegramOffset,
        timeout: 20,
        allowed_updates: ['message', 'callback_query']
      })
      if (updates?.ok && Array.isArray(updates.result)) {
        for (const upd of updates.result) {
          telegramOffset = Math.max(telegramOffset, (upd.update_id || 0) + 1)
          handleTelegramUpdate(token, upd).catch((err) => {
            console.error('[telegram] update error:', err)
          })
        }
      }
    } catch (err) {
      channelStats.telegram.state = 'degraded'
      channelStats.telegram.detail = `Polling retry: ${String(err?.message || err).slice(0, 80)}`
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

function buildBridgeStatus() {
  const cfg = loadConfig()
  const pairing = loadPairing()
  return {
    ok: true,
    pid: process.pid,
    channels: [
      {
        id: 'telegram',
        label: 'Telegram',
        enabled: Boolean(cfg.telegramEnabled),
        state: channelStats.telegram.state,
        detail: channelStats.telegram.detail,
        allowlistCount: new Set([...cfg.telegramAllowFrom, ...pairing.approvedTelegram]).size,
        activeThreads: activeThreads.telegram.size,
        lastInboundAt: channelStats.telegram.lastInboundAt,
        lastOutboundAt: channelStats.telegram.lastOutboundAt,
        botUsername: channelStats.telegram.botUsername
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        enabled: Boolean(cfg.whatsappEnabled),
        state: channelStats.whatsapp.state,
        detail: channelStats.whatsapp.detail,
        allowlistCount: new Set([...cfg.whatsappAllowFrom, ...pairing.approvedWhatsapp]).size,
        activeThreads: activeThreads.whatsapp.size,
        lastInboundAt: channelStats.whatsapp.lastInboundAt,
        lastOutboundAt: channelStats.whatsapp.lastOutboundAt,
        selfJid: channelStats.whatsapp.selfJid,
        qrDataUrl: channelStats.whatsapp.qrDataUrl,
        qrAscii: channelStats.whatsapp.qrAscii
      },
      {
        id: 'http',
        label: 'Unified HTTP & Webhooks',
        enabled: true,
        state: 'online',
        detail: `http://127.0.0.1:${String(cfg.bridgePort)}/v1/ask & /webhooks/:hookName`,
        allowlistCount: 1,
        activeThreads: activeThreads.http.size,
        lastInboundAt: channelStats.http.lastInboundAt,
        lastOutboundAt: channelStats.http.lastOutboundAt
      }
    ],
    recentDeliveries
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (raw.length > 4_000_000) {
        req.destroy()
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({ rawText: raw })
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(payload)}\n`)
}

const cfgBoot = loadConfig()
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${String(cfgBoot.bridgePort)}`)
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, service: 'orca-openclaw-bridge', pid: process.pid })
  }

  const secrets = loadSecrets()
  if (!constantTimeBearerOk(req.headers.authorization, secrets.ORCA_ECOSYSTEM_TOKEN)) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
  }

  if (req.method === 'GET' && url.pathname === '/v1/status') {
    return sendJson(res, 200, buildBridgeStatus())
  }

  if (req.method === 'POST' && url.pathname === '/v1/ask') {
    const body = await readRequestBody(req)
    const prompt = String(body.prompt || '').trim()
    if (!prompt) {
      return sendJson(res, 400, { ok: false, error: 'Missing prompt' })
    }
    channelStats.http.lastInboundAt = Date.now()
    const threadId = String(body.threadId || 'http:default')
    activeThreads.http.add(threadId)
    pushDelivery(body.source || 'http', 'local-api', prompt, 'accepted')
    const out = await dispatchAskToOrca({
      prompt,
      source: 'openclaw',
      externalId: threadId,
      senderName: body.senderName || 'HTTP API',
      wait: body.wait !== false,
      agent: body.agent,
      rikugan: Boolean(body.rikugan)
    })
    channelStats.http.lastOutboundAt = Date.now()
    return sendJson(res, 200, { ok: Boolean(out?.accepted), ...out })
  }

  if (req.method === 'POST' && url.pathname.startsWith('/webhooks/')) {
    const hookName =
      url.pathname.slice('/webhooks/'.length).replace(/[^a-zA-Z0-9_-]/g, '') || 'default'
    const payload = await readRequestBody(req)
    channelStats.http.lastInboundAt = Date.now()
    const summary = JSON.stringify(payload).slice(0, 3000)
    pushDelivery(`webhook:${hookName}`, 'webhook', summary, 'accepted')
    const out = await dispatchAskToOrca({
      prompt: `[Inbound Webhook '${hookName}']\nPayload:\n\`\`\`json\n${summary}\n\`\`\`\nProcess this event according to owner instructions.`,
      source: 'openclaw',
      externalId: `webhook:${hookName}`,
      senderName: `Webhook (${hookName})`,
      wait: false,
      rikugan: false
    })
    return sendJson(res, 202, { ok: true, hook: hookName, dispatched: out })
  }

  if (req.method === 'POST' && url.pathname === '/v1/notify') {
    const body = await readRequestBody(req)
    const message = String(body.message || '').trim()
    const targetChannel = String(body.channel || 'auto')
    if (!message) {
      return sendJson(res, 400, { ok: false, error: 'Missing message' })
    }
    const deliveredTo = []
    const cfg = loadConfig()
    const pairing = loadPairing()

    if (targetChannel === 'auto' || targetChannel === 'telegram') {
      const tgTargets = [...new Set([...cfg.telegramAllowFrom, ...pairing.approvedTelegram])]
      if (tgTargets[0] && secrets.TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage(tgTargets[0], message)
        deliveredTo.push(`telegram:${String(tgTargets[0])}`)
      }
    }
    if ((targetChannel === 'auto' || targetChannel === 'whatsapp') && isWhatsAppConnected()) {
      const selfJid = channelStats.whatsapp.selfJid
      if (selfJid) {
        await sendWhatsAppMessage(selfJid, message, true)
        deliveredTo.push(`whatsapp:${String(selfJid)}`)
      }
    }
    return sendJson(res, 200, { ok: deliveredTo.length > 0, deliveredTo })
  }

  if (req.method === 'POST' && url.pathname === '/v1/whatsapp/login') {
    startWhatsAppConnection(true).catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))
    return sendJson(res, 200, {
      ok: true,
      state: channelStats.whatsapp.state,
      qrDataUrl: channelStats.whatsapp.qrDataUrl,
      qrAscii: channelStats.whatsapp.qrAscii,
      selfJid: channelStats.whatsapp.selfJid
    })
  }

  if (req.method === 'POST' && url.pathname === '/v1/whatsapp/logout') {
    await logoutWhatsAppConnection()
    return sendJson(res, 200, { ok: true })
  }

  if (req.method === 'POST' && url.pathname === '/v1/shutdown') {
    sendJson(res, 200, { ok: true })
    setTimeout(() => process.exit(0), 150)
    return
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' })
})

server.listen(cfgBoot.bridgePort, '127.0.0.1', () => {
  console.log(`[orca-openclaw-bridge] listening on http://127.0.0.1:${String(cfgBoot.bridgePort)}`)
  startTelegramLoop().catch((err) => console.error('[telegram] fatal:', err))
  startWhatsAppConnection(false).catch(() => console.error('[whatsapp] fatal'))
})
