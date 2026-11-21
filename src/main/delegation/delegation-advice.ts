import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationPreferences
} from '../../shared/delegation/delegation-types'
import { routeDelegation } from './delegation-route'

function share(usedPercent: number | null): string {
  return usedPercent === null ? 'usage unread' : `${Math.round(usedPercent)}% used`
}

/**
 * Fork: the note a coordinator agent gets with each prompt (FORK.md "Auto-delegation"): which
 * workers have quota and how much of its own plan is left. Empty when the user turned it off.
 */
export function buildDelegationAdvice(
  preferences: DelegationPreferences,
  usage: readonly DelegationAccountUsage[],
  self: DelegationAgent
): string {
  const { enabled, ownUsedPercent } = preferences.autoDelegation
  if (!enabled) {
    return ''
  }
  const mine = usage.find((entry) => entry.agent === self && entry.active)
  const ownUsed = mine?.usedPercent ?? null
  const lines = [
    `[Orca auto-delegation, on by the user's preference] Your ${self} account (${mine?.label ?? 'system'}) is at ${share(ownUsed)}.`
  ]
  const others: DelegationPreferences = {
    ...preferences,
    agentOrder: preferences.agentOrder.filter((agent) => agent !== self)
  }
  const result = others.agentOrder.length ? routeDelegation(others, usage) : null
  if (!result || result.status === 'exhausted') {
    lines.push('No other agent has quota left, so do this work yourself.')
    return lines.join('\n')
  }
  const seen = new Set<DelegationAgent>()
  const workers = [result.route, ...result.alternatives].flatMap((route) => {
    if (seen.has(route.agent)) {
      return []
    }
    seen.add(route.agent)
    return [`${route.agent} on ${route.accountLabel ?? 'system'} (${share(route.usedPercent)})`]
  })
  lines.push(`Workers with quota: ${workers.join('; ')}.`)
  lines.push(
    ownUsed !== null && ownUsed >= ownUsedPercent
      ? `Your own plan is above ${ownUsedPercent}%: hand every task that creates or changes files, runs tests, or needs research or review to workers with the agent-delegation skill, even one-line fixes. Keep only planning and verification, and do not ask the user first.`
      : 'Delegate by default with the agent-delegation skill: any task that creates or changes files, writes or runs tests, or needs research or review goes to workers, even when it looks small; split independent pieces across workers in parallel. Keep planning and verification yourself, and do not ask the user first.'
  )
  lines.push(
    'Do it yourself only for a direct answer, a single one-line change, or when the user says to.'
  )
  return lines.join('\n')
}
