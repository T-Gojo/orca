#!/usr/bin/env node
/**
 * Fork (§16): Mac-standalone Hermes Intelligence Suite MCP Server (`orca-hermes`).
 * Provides across all 6 CLIs + Orca Bots:
 *   1. `orca_ptc` (`execute_code` — Programmatic Tool Calling over Rikugan + files + web + shell)
 *   2. `orca_review` (Hermes `/review` independent senior reviewer subagent dispatch)
 *   3. `orca_skills_hub` (`search`, `install`, `save`, `undo` with Trojan-Source strip & <=60-char lint)
 *   4. `orca_session_recall` (cross-session recall across Rikugan + local CLI transcripts)
 *   5. `ecosystem_notify` (proactive push to Telegram / WhatsApp)
 * Zero external npm dependencies; runs directly on Node 24 from ~/.config/orca-ecosystem/runtime/.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'

const HOME = os.homedir()
const ECO_DIR =
  process.env.ORCA_ECOSYSTEM_DIR?.trim() || path.join(HOME, '.config', 'orca-ecosystem')
const EXEC_CACHE_DIR = path.join(ECO_DIR, 'cache', 'exec')
const MAX_STDOUT_BYTES = 50_000
const MAX_SPILLED_BYTES = 5_000_000
const TROJAN_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\uFEFF]/g

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

function getSecrets() {
  const eco = readDotEnv(path.join(ECO_DIR, '.env'))
  const hermes = readDotEnv(path.join(HOME, '.hermes', '.env'))
  return { ...hermes, ...eco }
}

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ECO_DIR, 'config.json'), 'utf8'))
  } catch {
    return { bridgePort: 6770, rikuganUrl: 'http://127.0.0.1:5680' }
  }
}

async function callRikugan(toolName, args, timeoutMs = 8000) {
  const secrets = getSecrets()
  const cfg = getConfig()
  const token = String(secrets.RIKUGAN_TOKEN || process.env.RIKUGAN_TOKEN || '')
  if (!token) {
    return { error: 'RIKUGAN_TOKEN not configured' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const baseUrl = String(cfg.rikuganUrl || 'http://127.0.0.1:5680').replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/v1/tools/${String(toolName)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {}),
      signal: controller.signal
    })
    return await res.json()
  } catch (err) {
    return { error: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

async function callBridge(endpoint, body, timeoutMs = 15000) {
  const secrets = getSecrets()
  const cfg = getConfig()
  const port = String(cfg.bridgePort || 6770)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${String(endpoint)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(secrets.ORCA_ECOSYSTEM_TOKEN || '')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    })
    return await res.json()
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

function truncateAndSpillStdout(stdoutText) {
  const buf = Buffer.from(stdoutText, 'utf8')
  if (buf.length <= MAX_STDOUT_BYTES) {
    return { text: stdoutText, truncated: false, spillPath: null }
  }
  const headBytes = Math.floor(MAX_STDOUT_BYTES * 0.4)
  const tailBytes = MAX_STDOUT_BYTES - headBytes
  let spillPath = null
  try {
    fs.mkdirSync(EXEC_CACHE_DIR, { recursive: true, mode: 0o700 })
    const capped =
      stdoutText.length > MAX_SPILLED_BYTES
        ? `${stdoutText.slice(0, MAX_SPILLED_BYTES)}\n[... capped at 5MB ...]`
        : stdoutText
    const hash = crypto.createHash('sha256').update(capped).digest('hex').slice(0, 12)
    spillPath = path.join(EXEC_CACHE_DIR, `stdout-${hash}.txt`)
    fs.writeFileSync(spillPath, capped, { encoding: 'utf8', mode: 0o600 })
  } catch {
    spillPath = null
  }
  const omitted = String(buf.length - MAX_STDOUT_BYTES)
  const notice = spillPath
    ? `\n\n[... ${omitted} bytes omitted; FULL output saved to ${spillPath} ...]\n\n`
    : `\n\n[... ${omitted} bytes omitted ...]\n\n`
  const text =
    buf.subarray(0, headBytes).toString('utf8') +
    notice +
    buf.subarray(buf.length - tailBytes).toString('utf8')
  return { text, truncated: true, spillPath }
}

function buildFailureHint(stderrText) {
  if (!stderrText) {
    return null
  }
  if (/cannot import name '(\w+)' from 'orca_tools'/.test(stderrText)) {
    return 'Available imports from orca_tools: rikugan_search, rikugan_aggregate, rikugan_context, rikugan_remember, read_file, search_files, web_extract, shell, json_parse.'
  }
  if (/TypeError: string indices must be integers|has no attribute 'get'/.test(stderrText)) {
    return 'orca_tools functions return parsed dicts/objects already — do not json.loads() them.'
  }
  return null
}

/**
 * Hermes Programmatic Tool Calling (`execute_code` / `orca_ptc`):
 * Spawns a temporary local Unix-socket RPC server exposing Rikugan + file + web + shell tools,
 * generates `orca_tools.py`, executes the Python script in one turn, and returns compact stdout.
 */
async function executePtcCode({ code, workdir, timeoutSeconds = 90 }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-ptc-'))
  const sockPath = path.join(tmpDir, 'rpc.sock')
  let callCount = 0

  const handleRpcTool = async (method, params) => {
    callCount += 1
    if (callCount > 50) {
      throw new Error('Max 50 RPC tool calls per orca_ptc execution exceeded.')
    }
    switch (method) {
      case 'rikugan_search':
        return await callRikugan('search', {
          query: String(params.query || ''),
          limit: params.limit || 8
        })
      case 'rikugan_aggregate':
        return await callRikugan('aggregate', params)
      case 'rikugan_context':
        return await callRikugan('get_context', {
          task: String(params.task || ''),
          limit: params.limit || 8
        })
      case 'rikugan_remember':
        return await callRikugan('remember', params)
      case 'read_file': {
        const target = path.resolve(workdir || process.cwd(), String(params.path || ''))
        const lines = fs.readFileSync(target, 'utf8').split('\n')
        const offset = Math.max(1, Number(params.offset || 1))
        const limit = Math.min(2000, Math.max(1, Number(params.limit || 500)))
        return {
          total_lines: lines.length,
          content: lines.slice(offset - 1, offset - 1 + limit).join('\n')
        }
      }
      case 'search_files': {
        const cwd = workdir || process.cwd()
        const rg = spawnSync(
          'rg',
          ['-n', '--max-count', '50', String(params.pattern || ''), String(params.path || '.')],
          {
            cwd,
            encoding: 'utf8',
            timeout: 10_000
          }
        )
        return { matches: (rg.stdout || '').trim(), exit_code: rg.status ?? 0 }
      }
      case 'web_extract': {
        const url = String(params.url || '')
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 OrcaPTC/1.0' } })
        const html = await res.text()
        const stripped = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return {
          url,
          status: res.status,
          content: stripped.slice(0, Number(params.char_limit || 15000))
        }
      }
      case 'shell': {
        const sh = spawnSync('/bin/zsh', ['-lc', String(params.command || '')], {
          cwd: params.workdir || workdir || process.cwd(),
          encoding: 'utf8',
          timeout: Math.min(60_000, Number(params.timeout_ms || 20_000))
        })
        return {
          stdout: (sh.stdout || '').slice(0, 20_000),
          stderr: (sh.stderr || '').slice(0, 5_000),
          exit_code: sh.status ?? -1
        }
      }
      default:
        throw new Error(`Unknown orca_tools method: ${String(method)}`)
    }
  }

  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('data', async (chunk) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        try {
          const req = JSON.parse(line)
          const result = await handleRpcTool(req.method, req.params || {})
          conn.write(`${JSON.stringify({ ok: true, result })}\n`)
        } catch (err) {
          conn.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
        }
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sockPath, resolve)
  })

  const pyStub = `import json, os, socket

SOCK = ${JSON.stringify(sockPath)}

def _call(method, params):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(30.0)
    s.connect(SOCK)
    s.sendall((json.dumps({"method": method, "params": params}) + "\\n").encode("utf-8"))
    data = b""
    while not data.endswith(b"\\n"):
        chunk = s.recv(65536)
        if not chunk:
            break
        data += chunk
    s.close()
    resp = json.loads(data.decode("utf-8"))
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error", "RPC error"))
    return resp.get("result")

def json_parse(text):
    if isinstance(text, str) and text.startswith("\\ufeff"):
        text = text[1:]
    return json.loads(text, strict=False)

def rikugan_search(query, limit=8):
    return _call("rikugan_search", {"query": query, "limit": limit})

def rikugan_aggregate(**kwargs):
    return _call("rikugan_aggregate", kwargs)

def rikugan_context(task, limit=8):
    return _call("rikugan_context", {"task": task, "limit": limit})

def rikugan_remember(statement, kind="fact", evidence="orca_ptc"):
    return _call("rikugan_remember", {"statement": statement, "kind": kind, "evidence": evidence})

def read_file(path, offset=1, limit=500):
    return _call("read_file", {"path": path, "offset": offset, "limit": limit})

def search_files(pattern, path="."):
    return _call("search_files", {"pattern": pattern, "path": path})

def web_extract(url, char_limit=15000):
    return _call("web_extract", {"url": url, "char_limit": char_limit})

def shell(command, workdir=None, timeout_ms=20000):
    return _call("shell", {"command": command, "workdir": workdir, "timeout_ms": timeout_ms})
`
  fs.writeFileSync(path.join(tmpDir, 'orca_tools.py'), pyStub, 'utf8')
  const scriptFile = path.join(tmpDir, 'run_ptc.py')
  fs.writeFileSync(scriptFile, String(code || ''), 'utf8')

  const timeoutMs = Math.min(300_000, Math.max(5_000, Number(timeoutSeconds) * 1000))
  const pyResult = await new Promise((resolve) => {
    const child = spawn('python3', [scriptFile], {
      cwd: workdir || process.cwd(),
      env: { ...process.env, PYTHONPATH: `${tmpDir}:${process.env.PYTHONPATH || ''}` }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8')
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 })
    })
  })

  await new Promise((r) => server.close(r))
  fs.rmSync(tmpDir, { recursive: true, force: true })

  const out = truncateAndSpillStdout(pyResult.stdout)
  const hint = buildFailureHint(pyResult.stderr)
  return {
    exit_code: pyResult.exitCode,
    rpc_tool_calls: callCount,
    stdout: out.text,
    stdout_truncated: out.truncated,
    stdout_spill_path: out.spillPath,
    stderr: pyResult.stderr.slice(0, 10_000),
    ...(hint ? { hint } : {})
  }
}

async function recallSessions({ query, limit = 8 }) {
  const rikuganRes = await callRikugan('recall_sessions', { query: String(query || ''), limit })
  const localHits = []
  const claudeDir = path.join(HOME, '.claude', 'projects')
  if (query && fs.existsSync(claudeDir)) {
    const rg = spawnSync('rg', ['-i', '-m', '2', String(query), claudeDir], {
      encoding: 'utf8',
      timeout: 4_000
    })
    for (const line of (rg.stdout || '').split('\n').slice(0, 6)) {
      if (line.trim()) {
        localHits.push(line.slice(0, 260))
      }
    }
  }
  return { rikugan_sessions: rikuganRes, local_vault_matches: localHits }
}

function saveSkillDirect({ name, description, body }) {
  const cleanName = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const cleanDesc = String(description || '')
    .replace(TROJAN_RE, '')
    .replace(/["'\r\n]/g, '')
    .trim()
  const cleanBody = String(body || '')
    .replace(TROJAN_RE, '')
    .trim()
  if (!cleanName || cleanName.length < 2) {
    return { ok: false, error: 'Skill name must be kebab-case (>=2 chars).' }
  }
  if (!cleanDesc || cleanDesc.length > 60) {
    return {
      ok: false,
      error: `Hermes routing rule: description must be 1..60 chars (got ${String(cleanDesc.length)}).`
    }
  }
  const md = `---\nname: ${cleanName}\ndescription: "${cleanDesc}"\n---\n\n${cleanBody}\n`
  const canonicalDir = path.join(HOME, '.agents', 'skills', cleanName)
  const canonicalFile = path.join(canonicalDir, 'SKILL.md')
  const backupId = `${cleanName}-${String(Date.now())}`
  const backupDir = path.join(ECO_DIR, 'skill-backups', backupId)
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const existed = fs.existsSync(canonicalFile)
  if (existed) {
    fs.copyFileSync(canonicalFile, path.join(backupDir, 'PREVIOUS_SKILL.md'))
  }
  fs.mkdirSync(canonicalDir, { recursive: true })
  fs.writeFileSync(canonicalFile, md, 'utf8')
  fs.writeFileSync(path.join(backupDir, 'NEW_SKILL.md'), md, 'utf8')

  const homes = [
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.codex', 'skills'),
    path.join(HOME, '.kiro', 'skills'),
    path.join(HOME, '.gemini', 'skills'),
    path.join(HOME, '.config', 'opencode', 'skills'),
    path.join(HOME, '.vibe', 'skills')
  ]
  for (const h of homes) {
    try {
      fs.mkdirSync(path.join(h, cleanName), { recursive: true })
      fs.writeFileSync(path.join(h, cleanName, 'SKILL.md'), md, 'utf8')
    } catch {
      // Ignore missing CLI homes
    }
  }
  const idxFile = path.join(ECO_DIR, 'skill-backups', 'index.json')
  let entries = []
  try {
    entries = JSON.parse(fs.readFileSync(idxFile, 'utf8')).entries || []
  } catch {
    entries = []
  }
  entries.unshift({
    backupId,
    skillName: cleanName,
    action: existed ? 'patched' : 'created',
    description: cleanDesc,
    createdAt: Date.now(),
    scannerClean: true,
    sourceSessionId: null
  })
  fs.writeFileSync(
    idxFile,
    `${JSON.stringify({ entries: entries.slice(0, 100) }, null, 2)}\n`,
    'utf8'
  )
  return { ok: true, skillName: cleanName, backupId }
}

const TOOLS = [
  {
    name: 'orca_ptc',
    description:
      'Hermes Programmatic Tool Calling (execute_code): run a Python 3 script that imports `orca_tools` (rikugan_search, rikugan_aggregate, rikugan_context, rikugan_remember, read_file, search_files, web_extract, shell, json_parse) to execute multi-step data/repo pipelines in one zero-context-bloat turn.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Python 3 script using `from orca_tools import rikugan_search, read_file, ...` and printing concise results to stdout.'
        },
        workdir: { type: 'string', description: 'Optional working directory.' },
        timeoutSeconds: { type: 'number', description: 'Timeout in seconds (default 90, max 300).' }
      },
      required: ['code']
    }
  },
  {
    name: 'orca_review',
    description:
      'Dispatch an independent Hermes-style senior code/PR/work reviewer through Orca unified endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Specific branch, PR, file, or concern to review.' },
        workdir: { type: 'string', description: 'Repository path to review.' }
      }
    }
  },
  {
    name: 'orca_skills_hub',
    description:
      'Create, self-patch, or search reusable skills across ~/.agents/skills and all 6 CLIs with Hermes <=60-char routing descriptions and 1-tap Undo backup.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'list-learned'] },
        name: { type: 'string', description: 'Kebab-case skill name (for save).' },
        description: {
          type: 'string',
          description: 'Routing description <=60 characters (for save).'
        },
        body: { type: 'string', description: 'Markdown instructions body (for save).' }
      },
      required: ['action']
    }
  },
  {
    name: 'orca_session_recall',
    description:
      'Search past agent sessions across Rikugan (`recall_sessions`) and local CLI session vaults.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic, project, or decision to recall.' },
        limit: { type: 'number', description: 'Max results (default 8).' }
      },
      required: ['query']
    }
  },
  {
    name: 'ecosystem_notify',
    description:
      'Send a proactive notification or report to the owner on Telegram or WhatsApp via Orca OpenClaw bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Text message to deliver.' },
        channel: {
          type: 'string',
          enum: ['auto', 'telegram', 'whatsapp'],
          description: 'Target channel (default auto).'
        }
      },
      required: ['message']
    }
  }
]

async function handleToolCall(name, args) {
  switch (name) {
    case 'orca_ptc':
      return await executePtcCode(args || {})
    case 'orca_review': {
      const focusPart = args?.focus ? ` focused on: ${String(args.focus)}` : ''
      const workdirPart = args?.workdir ? ` in ${String(args.workdir)}` : ''
      const prompt = `Run an independent senior code & security review${focusPart}${workdirPart}. Inspect git status/diff, verify invariants, and report concrete findings.`
      return await callBridge('/v1/ask', { prompt, wait: false, source: 'hermes-review' })
    }
    case 'orca_skills_hub': {
      if (args?.action === 'save') {
        return saveSkillDirect(args)
      }
      const idxFile = path.join(ECO_DIR, 'skill-backups', 'index.json')
      try {
        return JSON.parse(fs.readFileSync(idxFile, 'utf8'))
      } catch {
        return { entries: [] }
      }
    }
    case 'orca_session_recall':
      return await recallSessions(args || {})
    case 'ecosystem_notify':
      return await callBridge('/v1/notify', {
        message: String(args?.message || ''),
        channel: args?.channel || 'auto'
      })
    default:
      throw new Error(`Unknown tool: ${String(name)}`)
  }
}

function sendJsonRpc(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

let stdinBuf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  stdinBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  let idx
  while ((idx = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, idx).trim()
    stdinBuf = stdinBuf.slice(idx + 1)
    if (!line) {
      continue
    }
    let req
    try {
      req = JSON.parse(line)
    } catch {
      continue
    }
    if (req.id === undefined || req.id === null) {
      continue
    }
    try {
      if (req.method === 'initialize') {
        sendJsonRpc({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'orca-hermes', version: '1.0.0' }
          }
        })
      } else if (req.method === 'tools/list') {
        sendJsonRpc({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } })
      } else if (req.method === 'tools/call') {
        const out = await handleToolCall(req.params?.name, req.params?.arguments || {})
        sendJsonRpc({
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
        })
      } else if (req.method === 'ping') {
        sendJsonRpc({ jsonrpc: '2.0', id: req.id, result: {} })
      } else {
        sendJsonRpc({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${String(req.method)}` }
        })
      }
    } catch (err) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Error: ${String(err?.message || err)}` }]
        }
      })
    }
  }
})
