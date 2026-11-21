import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { writeStdoutLine } from '../output/stdout-line'
import { getOptionalStringFlag } from '../arguments/flags'
import type {
  DelegationAccountUsage,
  DelegationPreferences,
  DelegationRoute,
  DelegationRouteResult
} from '../../shared/delegation/delegation-types'

const PROFILE_ACCOUNT = /claude-profiles[/\\]([0-9a-f-]{36})(?:[/\\]|$)/i

/** Inside a Claude Code session, the saved account it runs on: Orca routes each saved Claude
 *  account to its own `claude-profiles/<id>` config folder. Undefined when not in Claude Code or
 *  on the globally selected login. */
export function claudeSessionAccount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLAUDECODE !== '1') {
    return undefined
  }
  for (const value of [env.CLAUDE_CONFIG_DIR, env.ORCA_CLAUDE_PROFILE_POINTER]) {
    const match = value ? PROFILE_ACCOUNT.exec(value) : null
    if (match) {
      return match[1]
    }
  }
  return undefined
}

const BRIEF_REPEAT_MS = 30 * 60_000

/** Whether this session already got a brief with this key in the last half hour; records it if not. */
async function briefUnchanged(session: string, key: string): Promise<boolean> {
  if (!/^[\w-]{1,128}$/.test(session)) {
    return false
  }
  const dir = join(tmpdir(), 'orca-delegation-brief')
  const file = join(dir, session)
  const [previous, info] = await Promise.all([
    readFile(file, 'utf8').catch(() => null),
    stat(file).catch(() => null)
  ])
  if (previous === key && info && Date.now() - info.mtimeMs < BRIEF_REPEAT_MS) {
    return true
  }
  await mkdir(dir, { recursive: true })
  await writeFile(file, key)
  return false
}

function percent(value: number | null): string {
  return value === null ? 'unread' : `${Math.round(value)}% used`
}

function resets(entry: DelegationAccountUsage): string {
  const next = entry.windows
    .filter((window) => window.resetsAt !== null)
    .sort((a, b) => b.usedPercent - a.usedPercent)[0]
  return next?.resetsAt ? `, ${next.name} resets ${new Date(next.resetsAt).toLocaleString()}` : ''
}

export function formatDelegationUsage(usage: readonly DelegationAccountUsage[]): string {
  const lines: string[] = []
  let agent: string | null = null
  for (const entry of usage) {
    if (entry.agent !== agent) {
      agent = entry.agent
      lines.push(lines.length ? `\n${agent}` : agent)
    }
    const name = entry.label ?? entry.accountId ?? 'system'
    const state = entry.available ? 'available' : 'skip'
    const id = entry.accountId ?? 'system'
    lines.push(
      `  ${entry.active ? '*' : ' '} ${name} (${id}): ${percent(entry.usedPercent)}${resets(entry)} [${state}]${entry.error ? ` - ${entry.error}` : ''}`
    )
  }
  return lines.length ? lines.join('\n') : 'No delegation accounts found.'
}

function formatRoute(route: DelegationRoute): string {
  return `${route.agent} on ${route.accountLabel ?? route.accountId ?? 'system'}${route.model ? ` (${route.model})` : ''}. ${route.reason}`
}

export function formatDelegationRoute(result: DelegationRouteResult): string {
  if (result.status === 'exhausted') {
    return `No account available: ${result.reason}\n\n${formatDelegationUsage(result.usage)}`
  }
  const lines = [
    formatRoute(result.route),
    '',
    'Start it with:',
    `  orca orchestration worker-start --environment local --worktree current ${result.route.workerStartFlags.join(' ')} --spec-file <task.md>`
  ]
  if (result.alternatives.length) {
    lines.push('', 'Fallbacks if it fails or runs out:')
    for (const alternative of result.alternatives.slice(0, 4)) {
      lines.push(`  ${formatRoute(alternative)}  [${alternative.workerStartFlags.join(' ')}]`)
    }
  }
  return lines.join('\n')
}

/** Fork: `orca delegation ...` — usage-aware hand-off of work to other agents and accounts. */
export const DELEGATION_HANDLERS: Record<string, CommandHandler> = {
  'delegation usage': async ({ client, flags, json }) => {
    const response = await client.call<{ usage: DelegationAccountUsage[]; readAt: number }>(
      'delegation.usage',
      { refresh: !flags.has('cached') }
    )
    printResult(response, json, (value) => formatDelegationUsage(value.usage))
  },
  'delegation route': async ({ client, flags, json }) => {
    const agent = getOptionalStringFlag(flags, 'agent')
    const kind = getOptionalStringFlag(flags, 'kind')
    const tier = getOptionalStringFlag(flags, 'tier')
    const selfAccount = claudeSessionAccount()
    const response = await client.call<DelegationRouteResult>('delegation.route', {
      ...(agent ? { agent } : {}),
      ...(kind ? { kind } : {}),
      ...(tier ? { tier } : {}),
      ...(selfAccount ? { selfAccount } : {}),
      refresh: !flags.has('cached')
    })
    if (response.result.status === 'exhausted') {
      process.exitCode = 1
    }
    printResult(response, json, formatDelegationRoute)
  },
  'delegation advice': async ({ client, flags, json }) => {
    const agent = getOptionalStringFlag(flags, 'agent')
    const selfAccount = getOptionalStringFlag(flags, 'self-account') ?? claudeSessionAccount()
    const response = await client.call<{ advice: string; key: string }>('delegation.advice', {
      ...(agent ? { agent } : {}),
      ...(selfAccount ? { selfAccount } : {}),
      refresh: flags.has('fresh')
    })
    const session = getOptionalStringFlag(flags, 'session')
    const { advice, key } = response.result
    if (!json && advice && session && (await briefUnchanged(session, key))) {
      writeStdoutLine(
        '[Orca usage brief: no material change since your last prompt; the last brief still holds]'
      )
      return
    }
    if (json || advice) {
      printResult(response, json, (value) => value.advice)
    }
  },
  'delegation preferences': async ({ client, json }) => {
    const response = await client.call<{ path: string; preferences: DelegationPreferences }>(
      'delegation.preferences'
    )
    printResult(
      response,
      json,
      (value) =>
        `Edit ${value.path} to change how work is routed.\n\n${JSON.stringify(value.preferences, null, 2)}`
    )
  }
}
