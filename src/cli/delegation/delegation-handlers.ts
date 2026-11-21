import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { getOptionalStringFlag } from '../arguments/flags'
import type {
  DelegationAccountUsage,
  DelegationPreferences,
  DelegationRoute,
  DelegationRouteResult
} from '../../shared/delegation/delegation-types'

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
  return `${route.agent} on ${route.accountLabel ?? route.accountId ?? 'system'}${route.model ? ` (${route.model})` : ''}: ${route.reason}`
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
    const response = await client.call<DelegationRouteResult>('delegation.route', {
      ...(agent ? { agent } : {}),
      ...(kind ? { kind } : {}),
      refresh: !flags.has('cached')
    })
    if (response.result.status === 'exhausted') {
      process.exitCode = 1
    }
    printResult(response, json, formatDelegationRoute)
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
