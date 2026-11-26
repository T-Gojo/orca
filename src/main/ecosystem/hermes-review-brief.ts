import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { EcosystemHermesStatus } from '../../shared/ecosystem/ecosystem-types'
import { ecosystemPaths, readEcosystemConfig, readSkillBackupsIndex } from './ecosystem-config'

/** Fork: Hermes `/review` senior-reviewer brief builder & suite telemetry probe (§16). */

const REVIEW_GOAL =
  'Act as an independent senior reviewer. Thoroughly review the work presented in the conversation excerpt: ' +
  'investigate any code, pull request, branch, commit, documentation, or design it references (read the git diff ' +
  'and run targeted checks where feasible) rather than judging from the excerpt alone. Produce a structured review: ' +
  'what the work does, concrete defects or security risks (with file/line references), what was verified vs read, ' +
  'and a clear final verdict.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

/** Ports Hermes `agent/review_engine.py`: builds independent senior reviewer briefing. */
export function buildHermesReviewBrief(input: {
  messages: readonly { role: 'user' | 'assistant'; text: string }[]
  focus?: string
  loadedSkills?: readonly string[]
}): { goal: string; prompt: string } {
  const cleanFocus = (input.focus ?? '').replace(/\s+/g, ' ').trim()
  const rawGoal = cleanFocus ? `Review: ${cleanFocus}` : 'Review recent work'
  const goal = rawGoal.length > 80 ? `${rawGoal.slice(0, 79).trimEnd()}…` : rawGoal
  const recent = input.messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-10)
    .map((m) => ({
      role: m.role,
      text: m.text.length > 12_000 ? `${m.text.slice(0, 12_000)}\n[... truncated ...]` : m.text
    }))
  const lines: string[] = [REVIEW_GOAL, '', '--- Recent conversation (oldest first) ---']
  for (const msg of recent) {
    lines.push(msg.role === 'user' ? '[USER]' : '[PRIMARY AGENT]', msg.text, '')
  }
  lines.push('--- End of conversation excerpt ---')
  const skills = (input.loadedSkills ?? []).filter(Boolean).slice(0, 8)
  if (skills.length > 0) {
    lines.push(
      '',
      `Active skills in parent session: ${skills.join(', ')}. Judge the implementation against their conventions and invariants.`
    )
  }
  if (cleanFocus) {
    lines.push('', `Additional review focus from owner: ${cleanFocus}`)
  }
  return { goal, prompt: lines.join('\n') }
}

export async function probeHermesSuiteStatus(
  home: string = homedir()
): Promise<EcosystemHermesStatus> {
  const cfg = await readEcosystemConfig(home)
  const paths = ecosystemPaths(home)
  const skillsRoot = join(home, '.agents', 'skills')
  const [skillEntries, backups, usageRaw, hermesBinExists, mcpExists] = await Promise.all([
    readdir(skillsRoot, { withFileTypes: true }).catch(() => []),
    readSkillBackupsIndex(home),
    readFile(join(skillsRoot, '.usage.json'), 'utf8').catch(() => ''),
    exists(join(home, '.local', 'bin', 'hermes')),
    exists(join(paths.runtimeDir, 'orca-hermes-mcp.mjs'))
  ])
  const installedSkillsCount = skillEntries.filter(
    (e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')
  ).length
  const topSkillsUsed: { name: string; uses: number }[] = []
  let learningGraphEdges = backups.length
  if (usageRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(usageRaw)
      if (isRecord(parsed)) {
        for (const [name, val] of Object.entries(parsed)) {
          const count =
            typeof val === 'number'
              ? val
              : isRecord(val) && typeof val.count === 'number'
                ? val.count
                : 0
          if (count > 0) {
            topSkillsUsed.push({ name, uses: count })
            learningGraphEdges += 1
          }
        }
      }
    } catch {
      // Ignore malformed .usage.json
    }
  }
  topSkillsUsed.sort((a, b) => b.uses - a.uses)

  let legacyGatewayParked = true
  if (process.platform === 'darwin') {
    const uid = userInfo().uid
    const check = await runProcess({
      program: '/bin/launchctl',
      args: ['print', `gui/${uid}/ai.hermes.gateway`],
      timeoutMs: 2_000,
      maxOutputBytes: 2_048
    }).catch(() => null)
    if (check && check.code === 0 && check.stdout.includes('state = running')) {
      legacyGatewayParked = false
    }
  }

  return {
    state: mcpExists ? 'online' : 'degraded',
    autoLearnEnabled: cfg.autoLearnEnabled,
    ptcReady: mcpExists,
    reviewReady: true,
    skillsHubReady: true,
    hermesAcpInstalled: hermesBinExists,
    legacyGatewayParked,
    installedSkillsCount,
    learnedSkillsCount: backups.length,
    learningGraphEdges,
    topSkillsUsed: topSkillsUsed.slice(0, 6),
    recentLearnedSkills: backups.slice(0, 8),
    detail: mcpExists
      ? `PTC · /review · ${installedSkillsCount} skills (${backups.length} auto-learned)`
      : 'Stage runtime via `orca ecosystem up` to enable PTC & MCP tools'
  }
}
