import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { EcosystemSkillBackupEntry } from '../../shared/ecosystem/ecosystem-types'
import { ecosystemPaths, readSkillBackupsIndex, writeSkillBackupsIndex } from './ecosystem-config'

export { buildHermesReviewBrief, probeHermesSuiteStatus } from './hermes-review-brief'

/** Fork: Hermes skill validation, Trojan-Source sanitizer & 1-tap Undo persistence (§16). */

const TROJAN_UNICODE_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\uFEFF]/g
const SECRET_IN_SKILL_RE =
  /\b(?:sk-[A-Za-z0-9_-]{18,}|rkg_[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{30,})\b/

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

export function stripTrojanUnicode(input: string): string {
  return input.replace(TROJAN_UNICODE_RE, '')
}

export function parseAndValidateHermesSkill(markdown: string): {
  valid: boolean
  name: string
  description: string
  sanitized: string
  error: string | null
} {
  const sanitized = stripTrojanUnicode(markdown).replace(/\r\n/g, '\n')
  if (SECRET_IN_SKILL_RE.test(sanitized)) {
    return {
      valid: false,
      name: '',
      description: '',
      sanitized,
      error: 'Refused skill containing live-looking API token or secret.'
    }
  }
  const fmMatch = sanitized.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/)
  if (!fmMatch) {
    return {
      valid: false,
      name: '',
      description: '',
      sanitized,
      error: 'SKILL.md must begin with YAML frontmatter (--- ... ---) followed by instructions.'
    }
  }
  const frontmatter = fmMatch[1] ?? ''
  const body = (fmMatch[2] ?? '').trim()
  const nameMatch = frontmatter.match(/^name:\s*["']?([a-z0-9][a-z0-9-]{1,62})["']?\s*$/m)
  const descMatch = frontmatter.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)
  const name = nameMatch?.[1]?.trim() ?? ''
  const description = descMatch?.[1]?.trim() ?? ''
  if (!name) {
    return {
      valid: false,
      name: '',
      description,
      sanitized,
      error: 'Skill frontmatter requires kebab-case `name` (2–63 chars).'
    }
  }
  if (!description || description.length > 60) {
    return {
      valid: false,
      name,
      description,
      sanitized,
      error: `Skill description must be 1–60 chars per Hermes routing standard (got ${description.length}).`
    }
  }
  if (body.length < 30) {
    return {
      valid: false,
      name,
      description,
      sanitized,
      error: 'Skill body is too short to be a reusable workflow.'
    }
  }
  return { valid: true, name, description, sanitized, error: null }
}

function cliSkillHomes(home: string): string[] {
  return [
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.kiro', 'skills'),
    join(home, '.gemini', 'skills'),
    join(home, '.config', 'opencode', 'skills'),
    join(home, '.vibe', 'skills')
  ]
}

async function runSkillScannerIfAvailable(skillDir: string, home: string): Promise<boolean> {
  const candidates = [
    join(home, '.local', 'bin', 'skill-scanner'),
    '/opt/homebrew/bin/skill-scanner'
  ]
  for (const bin of candidates) {
    if (await exists(bin)) {
      const res = await runProcess({
        program: bin,
        args: ['scan', skillDir, '--fail-on-findings'],
        timeoutMs: 15_000,
        maxOutputBytes: 16_384
      }).catch(() => null)
      if (res) {
        return res.code === 0
      }
    }
  }
  return true
}

export async function saveValidatedSkillWithUndo(
  input: {
    markdown: string
    sourceSessionId?: string | null
    skipScanner?: boolean
  },
  home: string = homedir()
): Promise<{ ok: boolean; entry?: EcosystemSkillBackupEntry; error?: string }> {
  const check = parseAndValidateHermesSkill(input.markdown)
  if (!check.valid) {
    return { ok: false, error: check.error ?? 'Invalid skill format' }
  }
  const canonicalDir = join(home, '.agents', 'skills', check.name)
  const canonicalFile = join(canonicalDir, 'SKILL.md')
  const existed = await exists(canonicalFile)
  const backupId = `${check.name}-${Date.now()}`
  const { skillBackupsDir } = ecosystemPaths(home)
  const backupFolder = join(skillBackupsDir, backupId)
  await mkdir(backupFolder, { recursive: true, mode: 0o700 })
  if (existed) {
    await copyFile(canonicalFile, join(backupFolder, 'PREVIOUS_SKILL.md'))
  }
  await mkdir(canonicalDir, { recursive: true })
  await writeFile(canonicalFile, `${check.sanitized.trim()}\n`, 'utf8')
  await writeFile(join(backupFolder, 'NEW_SKILL.md'), `${check.sanitized.trim()}\n`, 'utf8')

  const scannerClean = input.skipScanner
    ? true
    : await runSkillScannerIfAvailable(canonicalDir, home)
  if (!scannerClean) {
    await (existed
      ? copyFile(join(backupFolder, 'PREVIOUS_SKILL.md'), canonicalFile)
      : rm(canonicalDir, { recursive: true, force: true }))
    return { ok: false, error: `skill-scanner rejected skill '${check.name}'. Reverted.` }
  }

  for (const targetRoot of cliSkillHomes(home).slice(1)) {
    const destDir = join(targetRoot, check.name)
    await mkdir(destDir, { recursive: true }).catch(() => {})
    await writeFile(join(destDir, 'SKILL.md'), `${check.sanitized.trim()}\n`, 'utf8').catch(
      () => {}
    )
  }

  const entry: EcosystemSkillBackupEntry = {
    backupId,
    skillName: check.name,
    action: existed ? 'patched' : 'created',
    description: check.description,
    createdAt: Date.now(),
    scannerClean,
    sourceSessionId: input.sourceSessionId ?? null
  }
  const existingIndex = await readSkillBackupsIndex(home)
  await writeSkillBackupsIndex([entry, ...existingIndex], home)
  return { ok: true, entry }
}

export async function undoLearnedSkill(
  backupIdOrSkillName: string,
  home: string = homedir()
): Promise<{ ok: boolean; restoredSkill: string | null; detail: string }> {
  const entries = await readSkillBackupsIndex(home)
  const target = entries.find(
    (e) => e.backupId === backupIdOrSkillName || e.skillName === backupIdOrSkillName
  )
  if (!target) {
    return {
      ok: false,
      restoredSkill: null,
      detail: `No learned skill backup matching '${backupIdOrSkillName}'.`
    }
  }
  const { skillBackupsDir } = ecosystemPaths(home)
  const prevFile = join(skillBackupsDir, target.backupId, 'PREVIOUS_SKILL.md')
  const hasPrev = await exists(prevFile)
  for (const root of cliSkillHomes(home)) {
    const skillDir = join(root, target.skillName)
    if (hasPrev) {
      await mkdir(skillDir, { recursive: true }).catch(() => {})
      await copyFile(prevFile, join(skillDir, 'SKILL.md')).catch(() => {})
    } else {
      await rm(skillDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  await writeSkillBackupsIndex(
    entries.filter((e) => e.backupId !== target.backupId),
    home
  )
  return {
    ok: true,
    restoredSkill: target.skillName,
    detail: hasPrev
      ? `Restored previous version of skill '${target.skillName}'.`
      : `Removed newly learned skill '${target.skillName}' from all CLIs.`
  }
}
