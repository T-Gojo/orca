import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import { ecosystemPaths, stageStandaloneEcosystemRuntime } from './ecosystem-config'
import { callBridgeJson } from './openclaw-connector'

/** Fork: Mac-standalone LaunchAgent lifecycle for OpenClaw bridge & legacy gateway parking (§16). */

const BridgePidSchema = z.object({
  pid: z.number().int().nullable().optional()
})

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

async function resolveExecutableNode(): Promise<string> {
  for (const candidate of [
    '/opt/homebrew/opt/node@24/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/opt/node@24/bin/node',
    '/usr/local/bin/node'
  ]) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return process.execPath
}

/** Installs Baileys + QR runtime deps inside Mac-internal `~/.config/orca-ecosystem/runtime/`. */
export async function ensureBridgeRuntimeDeps(
  repoRoot: string,
  home: string = homedir()
): Promise<string> {
  const runtimeDir = await stageStandaloneEcosystemRuntime(repoRoot, home)
  const baileysDir = join(runtimeDir, 'node_modules', '@whiskeysockets', 'baileys')
  if (await pathExists(baileysDir)) {
    return runtimeDir
  }
  for (const npmBin of [
    '/opt/homebrew/opt/node@24/bin/npm',
    '/opt/homebrew/bin/npm',
    '/usr/local/bin/npm'
  ]) {
    if (await pathExists(npmBin)) {
      await runProcess({
        program: npmBin,
        args: ['install', '--omit=dev', '--no-audit', '--no-fund'],
        cwd: runtimeDir,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:${process.env.PATH ?? ''}`
        },
        timeoutMs: 90_000,
        maxOutputBytes: 32_768
      }).catch(() => null)
      break
    }
  }
  return runtimeDir
}

export async function startOpenClawBridgeDaemon(
  repoRoot: string,
  home: string = homedir()
): Promise<{ running: boolean; pid: number | null; detail: string }> {
  const runtimeDir = await ensureBridgeRuntimeDeps(repoRoot, home)
  const paths = ecosystemPaths(home)
  const bridgeScript = join(runtimeDir, 'orca-openclaw-bridge.mjs')
  if (!(await pathExists(bridgeScript))) {
    return { running: false, pid: null, detail: `Missing bridge script at ${bridgeScript}` }
  }
  const existing = await callBridgeJson('/v1/status', { timeoutMs: 1_500, home })
  if (existing.ok) {
    const parsed = BridgePidSchema.safeParse(existing.data)
    return {
      running: true,
      pid: parsed.success ? (parsed.data.pid ?? null) : null,
      detail: 'OpenClaw bridge already online.'
    }
  }

  const nodeBin = await resolveExecutableNode()
  if (process.platform === 'darwin') {
    const plistPath = join(
      home,
      'Library',
      'LaunchAgents',
      'com.thunder.orca-ecosystem-bridge.plist'
    )
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
    const plistXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>Label</key><string>com.thunder.orca-ecosystem-bridge</string>',
      `  <key>ProgramArguments</key><array><string>${nodeBin}</string><string>${bridgeScript}</string></array>`,
      `  <key>WorkingDirectory</key><string>${runtimeDir}</string>`,
      '  <key>EnvironmentVariables</key><dict>',
      `    <key>HOME</key><string>${home}</string>`,
      `    <key>ORCA_ECOSYSTEM_DIR</key><string>${paths.root}</string>`,
      `    <key>PATH</key><string>/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${join(home, '.local', 'bin')}</string>`,
      '  </dict>',
      '  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>',
      `  <key>StandardOutPath</key><string>${join(paths.logsDir, 'bridge.out.log')}</string>`,
      `  <key>StandardErrorPath</key><string>${join(paths.logsDir, 'bridge.err.log')}</string>`,
      '</dict></plist>\n'
    ].join('\n')
    await writeFile(plistPath, plistXml, 'utf8')
    const uid = userInfo().uid
    await runProcess({
      program: '/bin/launchctl',
      args: ['bootout', `gui/${uid}/com.thunder.orca-ecosystem-bridge`],
      timeoutMs: 3_000,
      maxOutputBytes: 2_048
    }).catch(() => null)
    await runProcess({
      program: '/bin/launchctl',
      args: ['bootstrap', `gui/${uid}`, plistPath],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096
    }).catch(() => null)
    await runProcess({
      program: '/bin/launchctl',
      args: ['kickstart', '-k', `gui/${uid}/com.thunder.orca-ecosystem-bridge`],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096
    }).catch(() => null)
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((r) => setTimeout(r, 400))
    const check = await callBridgeJson('/v1/status', { timeoutMs: 1_500, home })
    if (check.ok) {
      const parsed = BridgePidSchema.safeParse(check.data)
      return {
        running: true,
        pid: parsed.success ? (parsed.data.pid ?? null) : null,
        detail: 'Started Mac-standalone OpenClaw bridge daemon.'
      }
    }
  }
  const errTail = await readFile(join(paths.logsDir, 'bridge.err.log'), 'utf8').catch(() => '')
  return {
    running: false,
    pid: null,
    detail: errTail.trim()
      ? `Bridge failed to bind: ${errTail.trim().slice(-240)}`
      : 'Bridge did not answer on :6770.'
  }
}

export async function stopOpenClawBridgeDaemon(home: string = homedir()): Promise<void> {
  await callBridgeJson('/v1/shutdown', { method: 'POST', timeoutMs: 2_000, home }).catch(() => null)
  if (process.platform === 'darwin') {
    const uid = userInfo().uid
    await runProcess({
      program: '/bin/launchctl',
      args: ['bootout', `gui/${uid}/com.thunder.orca-ecosystem-bridge`],
      timeoutMs: 4_000,
      maxOutputBytes: 2_048
    }).catch(() => null)
  }
}

/** Parks standalone `ai.hermes.gateway` so two gateways never poll the same Telegram/WhatsApp tokens. */
export async function parkLegacyHermesGateway(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true
  }
  const uid = userInfo().uid
  await runProcess({
    program: '/bin/launchctl',
    args: ['bootout', `gui/${uid}/ai.hermes.gateway`],
    timeoutMs: 4_000,
    maxOutputBytes: 4_096
  }).catch(() => null)
  return true
}
