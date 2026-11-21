import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationPreferences,
  DelegationRoute,
  DelegationRouteResult
} from '../../shared/delegation/delegation-types'

export type DelegationRouteRequest = {
  /** Only this agent; otherwise the preferences' order (or the kind's). */
  agent?: DelegationAgent
  kind?: string
}

function quoteFlag(value: string): string {
  return /^[\w.@:/-]+$/.test(value) ? value : `"${value.replace(/["\\]/g, '\\$&')}"`
}

function toRoute(
  usage: DelegationAccountUsage,
  model: string | null,
  reason: string
): DelegationRoute {
  const account = usage.accountId ?? 'system'
  return {
    agent: usage.agent,
    accountId: usage.accountId,
    accountLabel: usage.label,
    model,
    usedPercent: usage.usedPercent,
    reason,
    workerStartFlags: [
      `--agent ${usage.agent}`,
      `--account ${quoteFlag(account)}`,
      ...(model ? [`--model ${quoteFlag(model)}`] : [])
    ]
  }
}

/** Least-used first; an unread account sorts after every read one, since its share is unknown. */
function byHeadroom(a: DelegationAccountUsage, b: DelegationAccountUsage): number {
  return (a.usedPercent ?? 101) - (b.usedPercent ?? 101)
}

/**
 * Picks the agent, account and model for one delegated task: the first agent in the preferred
 * order with an account under the usage threshold, on its least-used account.
 */
export function routeDelegation(
  preferences: DelegationPreferences,
  usage: readonly DelegationAccountUsage[],
  request: DelegationRouteRequest = {}
): DelegationRouteResult {
  const kind = request.kind ? preferences.kinds[request.kind] : undefined
  if (request.kind && !kind) {
    throw new Error(
      `Unknown kind "${request.kind}". Known kinds: ${Object.keys(preferences.kinds).join(', ') || 'none'}.`
    )
  }
  const order: DelegationAgent[] = request.agent
    ? [request.agent]
    : (kind?.agents ?? preferences.agentOrder)
  const routes: DelegationRoute[] = []
  for (const agent of order) {
    const model = kind?.models?.[agent] ?? preferences.models[agent] ?? null
    // Saved accounts first: they are the ones Orca can pin a worker to.
    const candidates = usage
      .filter((entry) => entry.agent === agent && entry.available)
      .sort(
        (a, b) => byHeadroom(a, b) || Number(a.accountId === null) - Number(b.accountId === null)
      )
    for (const candidate of candidates) {
      const used =
        candidate.usedPercent === null
          ? 'usage not read yet'
          : `${Math.round(candidate.usedPercent)}% used`
      routes.push(
        toRoute(candidate, model, `${agent} is preference #${order.indexOf(agent) + 1}; ${used}`)
      )
    }
  }
  const [route, ...alternatives] = routes
  if (route) {
    return { status: 'routed', route, alternatives }
  }
  return {
    status: 'exhausted',
    reason: `Every ${order.join(', ')} account is at or above ${preferences.maxUsedPercent}% used, or failing.`,
    usage: usage.filter((entry) => order.includes(entry.agent))
  }
}
