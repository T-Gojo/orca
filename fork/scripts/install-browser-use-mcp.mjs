#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function parseArgs(argv) {
  let homeDir = os.homedir()
  let orcaDataDir = null
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--home' && argv[i + 1]) {
      homeDir = path.resolve(argv[++i])
    } else if (arg === '--orca-data' && argv[i + 1]) {
      orcaDataDir = path.resolve(argv[++i])
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: install-browser-use-mcp.mjs [--home <dir>] [--orca-data <dir>] [--dry-run]'
      )
      process.exit(0)
    }
  }
  return {
    homeDir,
    orcaDataDir: orcaDataDir ?? path.join(homeDir, 'Library', 'Application Support', 'Orca'),
    dryRun
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function findOnPath(name) {
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) {
      continue
    }
    const candidate = path.join(dir, name)
    if (isExecutable(candidate)) {
      return candidate
    }
  }
  return null
}

function discoverBrowserUse(homeDir) {
  const localBin = path.join(homeDir, '.local', 'bin', 'browser-use')
  if (isExecutable(localBin)) {
    return { command: localBin, args: ['--cli-mcp'] }
  }
  const onPath = findOnPath('browser-use')
  if (onPath) {
    return { command: onPath, args: ['--cli-mcp'] }
  }
  return { command: 'uvx', args: ['--from', 'browser-use[cli]', 'browser-use', '--cli-mcp'] }
}

function discoverComputerUse(homeDir) {
  const localBin = path.join(homeDir, '.local', 'bin', 'computer-use-mcp')
  if (isExecutable(localBin)) {
    return { command: localBin, args: ['serve'] }
  }
  return null
}

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) {
    return {}
  }
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function extractStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const out = {}
  let count = 0
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      out[k] = v
      count++
    }
  }
  return count > 0 ? out : undefined
}

function discoverDusk(homeDir) {
  const sources = [
    path.join(homeDir, '.claude.json'),
    path.join(homeDir, '.kiro', 'settings', 'mcp.json'),
    path.join(homeDir, '.gemini', 'settings.json'),
    path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
  ]
  let fallback = null
  for (const src of sources) {
    if (!fs.existsSync(src)) {
      continue
    }
    try {
      const data = readJsonOrEmpty(src)
      const entry = data.mcpServers?.dusk
      if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string' || !entry.url) {
        continue
      }
      const headers = extractStringMap(entry.headers)
      if (headers) {
        return { url: entry.url, headers }
      }
      fallback ??= { url: entry.url, headers: undefined }
    } catch {
      // Ignore unreadable source configs during discovery.
    }
  }
  if (fallback) {
    return fallback
  }
  if (fs.existsSync('/Applications/Dusk.app')) {
    return { url: 'http://127.0.0.1:8797/mcp', headers: undefined }
  }
  return null
}

function resolveWriteTarget(filePath) {
  try {
    const stat = fs.lstatSync(filePath)
    if (stat.isSymbolicLink()) {
      try {
        return fs.realpathSync(filePath)
      } catch {
        return path.resolve(path.dirname(filePath), fs.readlinkSync(filePath))
      }
    }
  } catch {
    // File does not exist yet.
  }
  return filePath
}

function writeText(filePath, text, dryRun) {
  if (dryRun) {
    return
  }
  const target = resolveWriteTarget(filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
}

function tomlString(value) {
  return JSON.stringify(String(value))
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)
}

function tomlStringArray(items) {
  return `[${items.map(tomlString).join(', ')}]`
}

function trimTrailingBlankLines(lines) {
  const out = [...lines]
  while (out.length > 0 && out.at(-1)?.trim() === '') {
    out.pop()
  }
  return out
}

function splitInputLines(filePath) {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const rawLines = raw === '' ? [] : raw.replace(/\r\n/g, '\n').split('\n')
  if (rawLines.length > 0 && rawLines.at(-1) === '') {
    rawLines.pop()
  }
  return rawLines
}

function joinBlocks(preamble, blocks) {
  const outLines = [...preamble]
  for (const block of blocks) {
    if (outLines.length > 0 && outLines.at(-1)?.trim() !== '') {
      outLines.push('')
    }
    outLines.push(...block.lines)
  }
  return `${trimTrailingBlankLines(outLines).join('\n')}\n`
}

function updateJsonMcp(filePath, { rootKey, stdioBuilder, httpBuilder, servers, dryRun }) {
  const data = readJsonOrEmpty(filePath)
  const section =
    data[rootKey] && typeof data[rootKey] === 'object' && !Array.isArray(data[rootKey])
      ? { ...data[rootKey] }
      : {}
  const statuses = []
  for (const srv of servers) {
    if (srv.kind === 'stdio') {
      section[srv.name] = stdioBuilder(srv)
      statuses.push(srv.name)
    } else if (srv.kind === 'http') {
      if (section[srv.name]) {
        statuses.push(`${srv.name} (preserved)`)
      } else {
        section[srv.name] = httpBuilder(srv)
        statuses.push(srv.name)
      }
    }
  }
  data[rootKey] = section
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`, dryRun)
  return statuses
}

function codexTableServerName(headerLine) {
  const m = headerLine.match(
    /^\s*\[\s*mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\.|\s*\])/
  )
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

function formatCodexBlock(srv) {
  const tableKey = tomlKey(srv.name)
  if (srv.kind === 'stdio') {
    return [
      `[mcp_servers.${tableKey}]`,
      `command = ${tomlString(srv.command)}`,
      `args = ${tomlStringArray(srv.args)}`
    ]
  }
  const lines = [`[mcp_servers.${tableKey}]`, `url = ${tomlString(srv.url)}`]
  if (srv.headers) {
    const pairs = Object.entries(srv.headers).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`)
    lines.push(`http_headers = { ${pairs.join(', ')} }`)
  }
  return lines
}

function updateCodexToml(filePath, servers, dryRun) {
  const rawLines = splitInputLines(filePath)
  const preamble = []
  const sections = []
  let current = null
  for (const line of rawLines) {
    if (/^\s*\[/.test(line)) {
      current = { header: line, lines: [line] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }

  const statuses = []
  for (const srv of servers) {
    const matchIndices = []
    for (let i = 0; i < sections.length; i++) {
      if (codexTableServerName(sections[i].header) === srv.name) {
        matchIndices.push(i)
      }
    }
    if (srv.kind === 'http' && matchIndices.length > 0) {
      statuses.push(`${srv.name} (preserved)`)
      continue
    }
    const blockLines = formatCodexBlock(srv)
    if (matchIndices.length > 0) {
      const firstIdx = matchIndices[0]
      sections[firstIdx] = { header: blockLines[0], lines: [...blockLines, ''] }
      for (let j = matchIndices.length - 1; j >= 1; j--) {
        sections.splice(matchIndices[j], 1)
      }
    } else {
      sections.push({ header: blockLines[0], lines: [...blockLines, ''] })
    }
    statuses.push(srv.name)
  }

  writeText(filePath, joinBlocks(preamble, sections), dryRun)
  return statuses
}

function formatVibeBlock(srv) {
  if (srv.kind === 'stdio') {
    return [
      '[[mcp_servers]]',
      `name = ${tomlString(srv.name)}`,
      'transport = "stdio"',
      `command = ${tomlString(srv.command)}`,
      `args = ${tomlStringArray(srv.args)}`
    ]
  }
  const lines = [
    '[[mcp_servers]]',
    `name = ${tomlString(srv.name)}`,
    'transport = "http"',
    `url = ${tomlString(srv.url)}`
  ]
  if (srv.headers) {
    lines.push('', '[mcp_servers.auth]', 'type = "static"', '', '[mcp_servers.auth.headers]')
    for (const [k, v] of Object.entries(srv.headers)) {
      lines.push(`${tomlKey(k)} = ${tomlString(v)}`)
    }
  }
  return lines
}

function extractVibeServerName(lines) {
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      break
    }
    const m = lines[i].match(/^\s*name\s*=\s*(?:"([^"]+)"|'([^']+)')/)
    if (m) {
      return m[1] ?? m[2]
    }
  }
  return null
}

function updateVibeToml(filePath, servers, dryRun) {
  const rawLines = splitInputLines(filePath)
  const preamble = []
  const blocks = []
  let current = null
  for (const line of rawLines) {
    const isMcpArray = /^\s*\[\[\s*mcp_servers\s*\]\]\s*(#.*)?$/.test(line)
    const isMcpSubtable = /^\s*\[\s*mcp_servers\./.test(line)
    const isAnyHeader = /^\s*\[/.test(line)
    if (isMcpArray) {
      current = { isMcp: true, lines: [line] }
      blocks.push(current)
    } else if (isMcpSubtable && current?.isMcp) {
      current.lines.push(line)
    } else if (isAnyHeader) {
      current = { isMcp: false, lines: [line] }
      blocks.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }

  const statuses = []
  for (const srv of servers) {
    const idx = blocks.findIndex((b) => b.isMcp && extractVibeServerName(b.lines) === srv.name)
    if (srv.kind === 'http' && idx !== -1) {
      statuses.push(`${srv.name} (preserved)`)
      continue
    }
    const blockLines = formatVibeBlock(srv)
    if (idx !== -1) {
      blocks[idx] = { isMcp: true, lines: [...blockLines, ''] }
    } else {
      blocks.push({ isMcp: true, lines: [...blockLines, ''] })
    }
    statuses.push(srv.name)
  }

  writeText(filePath, joinBlocks(preamble, blocks), dryRun)
  return statuses
}

function main() {
  const { homeDir, orcaDataDir, dryRun } = parseArgs(process.argv.slice(2))
  const browserUse = discoverBrowserUse(homeDir)
  const computerUse = discoverComputerUse(homeDir)
  const dusk = discoverDusk(homeDir)

  const servers = [
    { kind: 'stdio', name: 'browser-use', command: browserUse.command, args: browserUse.args }
  ]
  if (computerUse) {
    servers.push({
      kind: 'stdio',
      name: 'background-computer-use',
      command: computerUse.command,
      args: computerUse.args
    })
  }
  if (dusk) {
    servers.push({ kind: 'http', name: 'dusk', url: dusk.url, headers: dusk.headers })
  }

  const results = []
  const claudeStdio = (s) => ({ type: 'stdio', command: s.command, args: s.args })
  const claudeHttp = (s) => ({
    type: 'http',
    url: s.url,
    ...(s.headers ? { headers: { ...s.headers } } : {})
  })
  const plainStdio = (s) => ({ command: s.command, args: s.args })
  const plainHttp = (s) => ({
    url: s.url,
    ...(s.headers ? { headers: { ...s.headers } } : {})
  })
  const openCodeStdio = (s) => ({ type: 'local', command: [s.command, ...s.args], enabled: true })
  const openCodeHttp = (s) => ({
    type: 'remote',
    url: s.url,
    ...(s.headers ? { headers: { ...s.headers } } : {}),
    enabled: true
  })

  const claudeMain = path.join(homeDir, '.claude.json')
  results.push({
    label: 'Claude Code',
    target: claudeMain,
    names: updateJsonMcp(claudeMain, {
      rootKey: 'mcpServers',
      stdioBuilder: claudeStdio,
      httpBuilder: claudeHttp,
      servers,
      dryRun
    })
  })

  const profilesRoot = path.join(orcaDataDir, 'claude-profiles')
  if (fs.existsSync(profilesRoot)) {
    for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const profileClaude = path.join(profilesRoot, entry.name, 'home', '.claude.json')
      if (!fs.existsSync(profileClaude)) {
        continue
      }
      results.push({
        label: `Claude Code (profile ${entry.name})`,
        target: profileClaude,
        names: updateJsonMcp(profileClaude, {
          rootKey: 'mcpServers',
          stdioBuilder: claudeStdio,
          httpBuilder: claudeHttp,
          servers,
          dryRun
        })
      })
    }
  }

  const codexFile = path.join(homeDir, '.codex', 'config.toml')
  results.push({
    label: 'Codex',
    target: codexFile,
    names: updateCodexToml(codexFile, servers, dryRun)
  })

  const kiroFile = path.join(homeDir, '.kiro', 'settings', 'mcp.json')
  results.push({
    label: 'Kiro',
    target: kiroFile,
    names: updateJsonMcp(kiroFile, {
      rootKey: 'mcpServers',
      stdioBuilder: plainStdio,
      httpBuilder: plainHttp,
      servers,
      dryRun
    })
  })

  const agyMcpFile = path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
  results.push({
    label: 'Antigravity (mcp_config)',
    target: agyMcpFile,
    names: updateJsonMcp(agyMcpFile, {
      rootKey: 'mcpServers',
      stdioBuilder: plainStdio,
      httpBuilder: plainHttp,
      servers,
      dryRun
    })
  })

  const geminiSettingsFile = path.join(homeDir, '.gemini', 'settings.json')
  results.push({
    label: 'Antigravity (gemini settings)',
    target: geminiSettingsFile,
    names: updateJsonMcp(geminiSettingsFile, {
      rootKey: 'mcpServers',
      stdioBuilder: plainStdio,
      httpBuilder: claudeHttp,
      servers,
      dryRun
    })
  })

  const vibeFile = path.join(homeDir, '.vibe', 'config.toml')
  results.push({
    label: 'Mistral Vibe',
    target: vibeFile,
    names: updateVibeToml(vibeFile, servers, dryRun)
  })

  const openCodeFile = path.join(homeDir, '.config', 'opencode', 'opencode.json')
  results.push({
    label: 'OpenCode',
    target: openCodeFile,
    names: updateJsonMcp(openCodeFile, {
      rootKey: 'mcp',
      stdioBuilder: openCodeStdio,
      httpBuilder: openCodeHttp,
      servers,
      dryRun
    })
  })

  const prefix = dryRun ? '[dry-run] ' : ''
  console.log(`${prefix}Configured external browser/computer-use MCP servers:`)
  for (const { label, target, names } of results) {
    console.log(`  - ${label} (${target}): ${names.join(', ')}`)
  }
}

main()
