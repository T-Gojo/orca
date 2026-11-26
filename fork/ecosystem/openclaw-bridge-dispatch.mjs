/**
 * Fork (§16): OpenClaw Bridge dispatch, config/pairing store, Whisper STT & message chunking.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const HOME = os.homedir()
export const ECO_DIR =
  process.env.ORCA_ECOSYSTEM_DIR?.trim() || path.join(HOME, '.config', 'orca-ecosystem')
export const WA_AUTH_DIR = path.join(ECO_DIR, 'whatsapp-auth')
export const PAIRING_FILE = path.join(ECO_DIR, 'pairing.json')
export const CONFIG_FILE = path.join(ECO_DIR, 'config.json')
export const ENV_FILE = path.join(ECO_DIR, '.env')
export const CHAT_HISTORY_FILE = path.join(ECO_DIR, 'chat-history.json')

export function appendBridgeChatHistory(entry) {
  try {
    const cur = readJson(CHAT_HISTORY_FILE, { messages: [] })
    const list = Array.isArray(cur.messages) ? cur.messages : []
    list.push({
      id: `msg-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`,
      role: entry.role,
      source: String(entry.source || 'openclaw'),
      sender: String(entry.sender || 'User'),
      text: String(entry.text || '')
        .trim()
        .slice(0, 12_000),
      at: Date.now(),
      routedAgent: entry.routedAgent || null,
      rikuganUsed: Boolean(entry.rikuganUsed)
    })
    writeJsonAtomic(CHAT_HISTORY_FILE, { messages: list.slice(-100) })
  } catch {
    // Ignore history write failure
  }
}

export const recentDeliveries = []
export const sentWhatsAppIds = new Set()
export const activeThreads = { telegram: new Set(), whatsapp: new Set(), http: new Set() }
export const channelStats = {
  telegram: {
    lastInboundAt: null,
    lastOutboundAt: null,
    botUsername: null,
    state: 'unconfigured',
    detail: 'Idle'
  },
  whatsapp: {
    lastInboundAt: null,
    lastOutboundAt: null,
    selfJid: null,
    qrDataUrl: null,
    qrAscii: null,
    state: 'unconfigured',
    detail: 'Idle'
  },
  http: {
    lastInboundAt: null,
    lastOutboundAt: null,
    state: 'online',
    detail: 'Listening on loopback'
  }
}

export function pushDelivery(source, sender, preview, status = 'accepted') {
  recentDeliveries.unshift({
    id: `${String(source)}-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}`,
    source,
    sender: String(sender || 'local'),
    preview: String(preview || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140),
    at: Date.now(),
    status
  })
  if (recentDeliveries.length > 30) {
    recentDeliveries.length = 30
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${String(filePath)}.tmp-${String(process.pid)}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

function readDotEnv(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) {
    return out
  }
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const k = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

export function loadConfig() {
  return {
    bridgePort: 6770,
    rikuganUrl: 'http://127.0.0.1:5680',
    telegramEnabled: true,
    whatsappEnabled: true,
    whatsappMode: 'self-chat',
    voiceReplyMode: 'mirror-voice',
    telegramAllowFrom: [],
    whatsappAllowFrom: [],
    ...readJson(CONFIG_FILE, {})
  }
}

export function loadSecrets() {
  return {
    ...readDotEnv(path.join(HOME, '.hermes', '.env')),
    ...readDotEnv(ENV_FILE)
  }
}

export function loadPairing() {
  const raw = readJson(PAIRING_FILE, { pending: [], approvedTelegram: [], approvedWhatsapp: [] })
  const now = Date.now()
  return {
    pending: Array.isArray(raw.pending) ? raw.pending.filter((p) => p.expiresAt > now) : [],
    approvedTelegram: Array.isArray(raw.approvedTelegram) ? raw.approvedTelegram : [],
    approvedWhatsapp: Array.isArray(raw.approvedWhatsapp) ? raw.approvedWhatsapp : []
  }
}

export function issuePairingCode(channel, senderId, senderName) {
  const store = loadPairing()
  const existing = store.pending.find(
    (p) => p.channel === channel && p.senderId === String(senderId)
  )
  if (existing) {
    return String(existing.code)
  }
  const code = String(crypto.randomInt(100000, 999999))
  store.pending.push({
    code,
    channel,
    senderId: String(senderId),
    senderName: senderName ? String(senderName) : null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60_000
  })
  writeJsonAtomic(PAIRING_FILE, store)
  return code
}

export function constantTimeBearerOk(authHeader, expectedToken) {
  if (!expectedToken) {
    return false
  }
  const got = String(authHeader || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  const a = Buffer.from(got, 'utf8')
  const b = Buffer.from(expectedToken, 'utf8')
  if (a.length !== b.length) {
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

const EXPLICIT_RIKUGAN_RE = /(?:^|[\s/@#"'`(])rikugan\b/i

export function isExplicitRikuganPrompt(text) {
  return EXPLICIT_RIKUGAN_RE.test(String(text || ''))
}

async function callOrcaCliAsk({
  prompt,
  source,
  externalId,
  senderName,
  wait = true,
  agent,
  rikugan = false
}) {
  const candidates = [
    process.env.ORCA_CLI_PATH,
    '/Applications/Orca.app/Contents/Resources/bin/orca',
    path.join(HOME, '.local', 'bin', 'orca'),
    '/usr/local/bin/orca',
    '/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js'
  ].filter(Boolean)

  let bin = 'orca'
  let prefixArgs = []
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      if (c.endsWith('.js')) {
        bin = process.execPath
        prefixArgs = [c]
      } else {
        bin = c
      }
      break
    }
  }

  const cliArgs = [
    ...prefixArgs,
    'ecosystem',
    'ask',
    '--prompt',
    prompt,
    '--source',
    source || 'openclaw',
    '--thread',
    externalId || 'http:default',
    ...(senderName ? ['--sender', senderName] : []),
    ...(agent ? ['--agent', agent] : []),
    ...(rikugan ? ['--rikugan'] : []),
    ...(wait ? ['--wait'] : []),
    '--json'
  ]

  return await new Promise((resolve, reject) => {
    const child = spawnSync(bin, cliArgs, {
      encoding: 'utf8',
      timeout: wait ? 180_000 : 20_000,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${path.join(HOME, '.local', 'bin')}`
      }
    })
    if (child.status !== 0) {
      reject(new Error((child.stderr || child.stdout || 'orca CLI failed').trim().slice(0, 300)))
      return
    }
    try {
      const parsed = JSON.parse(child.stdout.trim())
      resolve(parsed?.result ?? parsed)
    } catch (e) {
      reject(new Error(`Invalid JSON from orca ecosystem ask: ${String(e?.message || e)}`))
    }
  })
}

export async function dispatchAskToOrca({
  prompt,
  source,
  externalId,
  senderName,
  wait = true,
  agent,
  rikugan = false
}) {
  const wantRikugan = Boolean(rikugan) || isExplicitRikuganPrompt(prompt)
  try {
    return await callOrcaCliAsk({
      prompt,
      source,
      externalId,
      senderName,
      wait,
      agent,
      rikugan: wantRikugan
    })
  } catch (rpcErr) {
    const secrets = loadSecrets()
    const cfg = loadConfig()
    let contextBlock = ''
    if (wantRikugan && secrets.RIKUGAN_TOKEN) {
      try {
        const baseUrl = String(cfg.rikuganUrl).replace(/\/+$/, '')
        const rRes = await fetch(`${baseUrl}/v1/tools/get_context`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${String(secrets.RIKUGAN_TOKEN)}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ task: String(prompt).slice(0, 500), limit: 6 })
        })
        const rJson = await rRes.json()
        if (rJson?.brief) {
          contextBlock = `Owner context from Rikugan:\n${String(rJson.brief)}\n\n`
        }
      } catch {
        // Ignore Rikugan fallback errors
      }
    }
    if (secrets.OAIBO_API_KEY) {
      const llmRes = await fetch('https://oaibo.jumpbump.in/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${String(secrets.OAIBO_API_KEY)}`,
          'Content-Type': 'application/json',
          'X-App-Name': 'orca-ecosystem-bridge'
        },
        body: JSON.stringify({
          model: 'agy_gemini-3.8-flash-medium',
          messages: [
            {
              role: 'system',
              content:
                'You are Orca HQ (fallback standalone mode while Orca Desktop is closed). Answer concisely and accurately.'
            },
            { role: 'user', content: `${contextBlock}${String(prompt)}` }
          ]
        })
      })
      const llmJson = await llmRes.json()
      const text = llmJson?.choices?.[0]?.message?.content || null
      if (text) {
        appendBridgeChatHistory({
          role: 'user',
          source: source || 'openclaw',
          sender: senderName || 'Owner',
          text: prompt,
          rikuganUsed: Boolean(contextBlock)
        })
        appendBridgeChatHistory({
          role: 'assistant',
          source: source || 'openclaw',
          sender: 'Orca HQ',
          text,
          routedAgent: 'oaibo-fallback',
          rikuganUsed: Boolean(contextBlock)
        })
        return {
          accepted: true,
          sessionId: null,
          botId: null,
          routedAgent: 'oaibo-fallback',
          routedAccount: null,
          rikuganItemsAttached: contextBlock ? 1 : 0,
          reply: text,
          error: null
        }
      }
    }
    return {
      accepted: false,
      sessionId: null,
      botId: null,
      routedAgent: null,
      routedAccount: null,
      rikuganItemsAttached: 0,
      reply: null,
      error: String(rpcErr?.message || rpcErr)
    }
  }
}

export async function transcribeAudioBuffer(audioBuf, ext = '.ogg') {
  const tmpFile = path.join(os.tmpdir(), `orca-voice-${String(Date.now())}${String(ext)}`)
  fs.writeFileSync(tmpFile, audioBuf, { mode: 0o600 })
  try {
    for (const bin of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']) {
      if (fs.existsSync(bin)) {
        const out = spawnSync(bin, ['-f', tmpFile, '-nt'], { encoding: 'utf8', timeout: 30_000 })
        if (out.status === 0 && out.stdout?.trim()) {
          return out.stdout.trim()
        }
      }
    }
    const secrets = loadSecrets()
    if (secrets.OAIBO_API_KEY) {
      const form = new FormData()
      form.append('file', new Blob([audioBuf]), `voice${String(ext)}`)
      form.append('model', 'whisper-1')
      const res = await fetch('https://oaibo.jumpbump.in/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${String(secrets.OAIBO_API_KEY)}`,
          'X-App-Name': 'orca-ecosystem-bridge'
        },
        body: form
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.text) {
          return String(data.text).trim()
        }
      }
    }
    return null
  } catch {
    return null
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
}

export function chunkMessage(text, maxLen = 3900) {
  const clean = String(text || '').trim()
  if (clean.length <= maxLen) {
    return [clean || '(empty response)']
  }
  const chunks = []
  let rest = clean
  while (rest.length > maxLen) {
    let splitAt = rest.lastIndexOf('\n', maxLen)
    if (splitAt < maxLen * 0.4) {
      splitAt = maxLen
    }
    chunks.push(rest.slice(0, splitAt))
    rest = rest.slice(splitAt).trimStart()
  }
  if (rest) {
    chunks.push(rest)
  }
  return chunks
}
