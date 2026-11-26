import { randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  EcosystemPairingRequestSchema,
  EcosystemSkillBackupEntrySchema,
  type EcosystemPairingRequest,
  type EcosystemSkillBackupEntry
} from '../../shared/ecosystem/ecosystem-types'

/** Fork: Mac-internal config, secret env, pairing, and runtime staging for Orca Ecosystem (§16). */

export const EcosystemConfigSchema = z.object({
  bridgePort: z.number().int().min(1024).max(65535).default(6770),
  rikuganUrl: z.string().default('http://127.0.0.1:5680'),
  rikuganUiUrl: z.string().default('http://127.0.0.1:5690'),
  autoLearnEnabled: z.boolean().default(true),
  telegramEnabled: z.boolean().default(true),
  whatsappEnabled: z.boolean().default(true),
  whatsappMode: z.enum(['self-chat', 'dedicated']).default('self-chat'),
  voiceReplyMode: z.enum(['off', 'mirror-voice', 'always']).default('mirror-voice'),
  telegramAllowFrom: z.array(z.string()).default([]),
  whatsappAllowFrom: z.array(z.string()).default([]),
  primaryBotName: z.string().default('Orca HQ')
})
export type EcosystemConfig = z.infer<typeof EcosystemConfigSchema>

const PairingStoreSchema = z.object({
  pending: z.array(EcosystemPairingRequestSchema).default([]),
  approvedTelegram: z.array(z.string()).default([]),
  approvedWhatsapp: z.array(z.string()).default([])
})
type PairingStore = z.infer<typeof PairingStoreSchema>

const SkillBackupIndexSchema = z.object({
  entries: z.array(EcosystemSkillBackupEntrySchema).default([])
})

export function ecosystemRootDir(home: string = homedir()): string {
  return process.env.ORCA_ECOSYSTEM_DIR?.trim() || join(home, '.config', 'orca-ecosystem')
}

export function ecosystemPaths(home: string = homedir()) {
  const root = ecosystemRootDir(home)
  return {
    root,
    configFile: join(root, 'config.json'),
    envFile: join(root, '.env'),
    pairingFile: join(root, 'pairing.json'),
    runtimeDir: join(root, 'runtime'),
    whatsappAuthDir: join(root, 'whatsapp-auth'),
    skillBackupsDir: join(root, 'skill-backups'),
    skillBackupsIndex: join(root, 'skill-backups', 'index.json'),
    execCacheDir: join(root, 'cache', 'exec'),
    logsDir: join(root, 'logs')
  }
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

export function parseDotEnvText(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (/^[A-Z0-9_]+$/.test(key)) {
      out[key] = val
    }
  }
  return out
}

function serializeDotEnv(entries: Record<string, string>): string {
  const lines = ['# Orca Unified Ecosystem secrets (mode 0600, local Mac SSD only — never commit).']
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key] ?? ''
    if (!value) {
      continue
    }
    const safe = /[\s#"']/.test(value) ? JSON.stringify(value) : value
    lines.push(`${key}=${safe}`)
  }
  return `${lines.join('\n')}\n`
}

export async function ensureEcosystemDirs(home: string = homedir()): Promise<void> {
  const paths = ecosystemPaths(home)
  await Promise.all([
    mkdir(paths.root, { recursive: true, mode: 0o700 }),
    mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.whatsappAuthDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.skillBackupsDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.execCacheDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.logsDir, { recursive: true, mode: 0o700 })
  ])
  await chmod(paths.root, 0o700).catch(() => {})
}

export async function readEcosystemConfig(home: string = homedir()): Promise<EcosystemConfig> {
  const { configFile } = ecosystemPaths(home)
  const raw = await readFile(configFile, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return EcosystemConfigSchema.parse({})
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    const validated = EcosystemConfigSchema.safeParse(parsed)
    return validated.success ? validated.data : EcosystemConfigSchema.parse({})
  } catch {
    return EcosystemConfigSchema.parse({})
  }
}

export async function writeEcosystemConfig(
  patch: Partial<EcosystemConfig>,
  home: string = homedir()
): Promise<EcosystemConfig> {
  await ensureEcosystemDirs(home)
  const current = await readEcosystemConfig(home)
  const next = EcosystemConfigSchema.parse({ ...current, ...patch })
  const { configFile } = ecosystemPaths(home)
  await writeFile(configFile, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  return next
}

export async function readEcosystemSecrets(
  home: string = homedir()
): Promise<Record<string, string>> {
  await ensureEcosystemDirs(home)
  const { envFile } = ecosystemPaths(home)
  const raw = await readFile(envFile, 'utf8').catch(() => '')
  const secrets = parseDotEnvText(raw)
  let dirty = false
  if (!secrets.ORCA_ECOSYSTEM_TOKEN) {
    secrets.ORCA_ECOSYSTEM_TOKEN = `orca_eco_${randomBytes(24).toString('hex')}`
    dirty = true
  }
  // Seed RIKUGAN_TOKEN, OAIBO_API_KEY, and TELEGRAM_BOT_TOKEN from ~/.hermes/.env if not set yet.
  if (!secrets.RIKUGAN_TOKEN || !secrets.OAIBO_API_KEY || !secrets.TELEGRAM_BOT_TOKEN) {
    const hermesEnv = await readFile(join(home, '.hermes', '.env'), 'utf8').catch(() => '')
    const parsedHermes = parseDotEnvText(hermesEnv)
    for (const key of ['RIKUGAN_TOKEN', 'OAIBO_API_KEY', 'TELEGRAM_BOT_TOKEN']) {
      if (!secrets[key] && parsedHermes[key]) {
        secrets[key] = parsedHermes[key]
        dirty = true
      }
    }
  }
  if (dirty) {
    await writeFile(envFile, serializeDotEnv(secrets), { encoding: 'utf8', mode: 0o600 })
    await chmod(envFile, 0o600).catch(() => {})
  }
  return secrets
}

export async function setEcosystemSecret(
  key: string,
  value: string,
  home: string = homedir()
): Promise<void> {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new Error(`Invalid secret key: ${key}`)
  }
  const secrets = await readEcosystemSecrets(home)
  if (value.trim()) {
    secrets[key] = value.trim()
  } else {
    delete secrets[key]
  }
  const { envFile } = ecosystemPaths(home)
  await writeFile(envFile, serializeDotEnv(secrets), { encoding: 'utf8', mode: 0o600 })
  await chmod(envFile, 0o600).catch(() => {})
}

export async function readPairingStore(home: string = homedir()): Promise<PairingStore> {
  const { pairingFile } = ecosystemPaths(home)
  const raw = await readFile(pairingFile, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return PairingStoreSchema.parse({})
  }
  try {
    const parsed = PairingStoreSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return PairingStoreSchema.parse({})
    }
    const now = Date.now()
    return {
      ...parsed.data,
      pending: parsed.data.pending.filter((item) => item.expiresAt > now)
    }
  } catch {
    return PairingStoreSchema.parse({})
  }
}

export async function approvePairingCode(
  code: string,
  home: string = homedir()
): Promise<EcosystemPairingRequest | null> {
  const clean = code.trim()
  const store = await readPairingStore(home)
  const match = store.pending.find((entry) => entry.code === clean)
  if (!match) {
    return null
  }
  const nextPending = store.pending.filter((entry) => entry.code !== clean)
  const approvedTelegram = new Set(store.approvedTelegram)
  const approvedWhatsapp = new Set(store.approvedWhatsapp)
  if (match.channel === 'telegram') {
    approvedTelegram.add(match.senderId)
  } else {
    approvedWhatsapp.add(match.senderId)
  }
  const next: PairingStore = {
    pending: nextPending,
    approvedTelegram: [...approvedTelegram],
    approvedWhatsapp: [...approvedWhatsapp]
  }
  const { pairingFile } = ecosystemPaths(home)
  await ensureEcosystemDirs(home)
  await writeFile(pairingFile, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  const cfg = await readEcosystemConfig(home)
  await writeEcosystemConfig(
    {
      telegramAllowFrom: [...new Set([...cfg.telegramAllowFrom, ...approvedTelegram])],
      whatsappAllowFrom: [...new Set([...cfg.whatsappAllowFrom, ...approvedWhatsapp])]
    },
    home
  )
  return match
}

export async function readSkillBackupsIndex(
  home: string = homedir()
): Promise<EcosystemSkillBackupEntry[]> {
  const { skillBackupsIndex } = ecosystemPaths(home)
  const raw = await readFile(skillBackupsIndex, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }
  try {
    const parsed = SkillBackupIndexSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.entries : []
  } catch {
    return []
  }
}

export async function writeSkillBackupsIndex(
  entries: EcosystemSkillBackupEntry[],
  home: string = homedir()
): Promise<void> {
  await ensureEcosystemDirs(home)
  const { skillBackupsIndex } = ecosystemPaths(home)
  await writeFile(
    skillBackupsIndex,
    `${JSON.stringify({ entries: entries.slice(0, 100) }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

/** Copies fork ecosystem scripts onto the Mac internal SSD so runtime survives Thunder SSD removal. */
export async function stageStandaloneEcosystemRuntime(
  repoOrAppRoot: string,
  home: string = homedir()
): Promise<string> {
  await ensureEcosystemDirs(home)
  const { runtimeDir } = ecosystemPaths(home)
  const candidates = [
    join(repoOrAppRoot, 'fork', 'ecosystem'),
    join(dirname(repoOrAppRoot), 'fork', 'ecosystem'),
    '/Volumes/ssd_thunder_apfs/MainCodeBase/OpenSourceGit/orca/fork/ecosystem'
  ]
  for (const dir of candidates) {
    if (await pathExists(join(dir, 'orca-openclaw-bridge.mjs'))) {
      for (const file of [
        'orca-openclaw-bridge.mjs',
        'openclaw-bridge-dispatch.mjs',
        'openclaw-whatsapp-adapter.mjs',
        'orca-hermes-mcp.mjs',
        'package.json'
      ]) {
        const src = join(dir, file)
        if (await pathExists(src)) {
          await copyFile(src, join(runtimeDir, file))
          if (file.endsWith('.mjs')) {
            await chmod(join(runtimeDir, file), 0o755).catch(() => {})
          }
        }
      }
      break
    }
  }
  return runtimeDir
}
