import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationPreferences,
  DelegationRoute,
  DelegationRouteResult,
  DelegationTier
} from '../../shared/delegation/delegation-types'
import { DELEGATION_TIERS } from '../../shared/delegation/delegation-types'
import { accountPace } from './delegation-pace'

export type DelegationRouteRequest = {
  /** Only this agent; otherwise the preferences' order (or the kind's). */
  agent?: DelegationAgent
  kind?: string
  /** The task's difficulty: only agents at or above this tier. */
  tier?: DelegationTier
  /** `agent:accountId` (or `agent:system`) keys to leave out, e.g. the coordinator's own account. */
  exclude?: readonly string[]
  now?: number
}

export function delegationAccountKey(usage: Pick<DelegationAccountUsage, 'agent' | 'accountId'>) {
  return `${usage.agent}:${usage.accountId ?? 'system'}`
}

function quoteFlag(value: string): string {
  return /^[\w.@:/-]+$/.test(value) ? value : `"${value.replace(/["\\]/g, '\\$&')}"`
}

const tierRank = (tier: DelegationTier) => DELEGATION_TIERS.indexOf(tier)

type Candidate = { usage: DelegationAccountUsage; route: DelegationRoute; score: number }

function describe(candidate: DelegationRoute, order: readonly DelegationAgent[]): string {
  const pace = candidate.pace
  const why = !pace
    ? 'usage not read yet'
    : pace.expiring >= 5
      ? `${Math.round(pace.expiring)}% of its plan would reset unused; ${Math.round(pace.spare)}% usable now`
      : `${Math.round(pace.spare)}% usable now`
  return `${candidate.agent} (${candidate.tier}, preference #${order.indexOf(candidate.agent) + 1}): ${why}`
}

/**
 * Fork: picks the agent, account and model for one delegated task. Among accounts under the usage
 * threshold whose agent is capable enough, quota that would otherwise reset unused goes first, then
 * the most usable share; an exact tier match and the preferred order break near-ties.
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
  const excluded = new Set(request.exclude ?? [])
  const now = request.now ?? Date.now()
  const candidates: Candidate[] = []
  for (const entry of usage) {
    const rank = order.indexOf(entry.agent)
    const tier = preferences.profiles[entry.agent]?.tier ?? 'standard'
    if (
      rank === -1 ||
      !entry.available ||
      excluded.has(delegationAccountKey(entry)) ||
      (request.tier && tierRank(tier) < tierRank(request.tier))
    ) {
      continue
    }
    const model = kind?.models?.[entry.agent] ?? preferences.models[entry.agent] ?? null
    const pace = accountPace(entry, now)
    const route: DelegationRoute = {
      agent: entry.agent,
      accountId: entry.accountId,
      accountLabel: entry.label,
      model,
      usedPercent: entry.usedPercent,
      tier,
      pace,
      reason: '',
      workerStartFlags: [
        `--agent ${entry.agent}`,
        `--account ${quoteFlag(entry.accountId ?? 'system')}`,
        ...(model ? [`--model ${quoteFlag(model)}`] : [])
      ]
    }
    route.reason = describe(route, order)
    // Unread accounts rank after read ones; saved accounts before the agent's System default.
    const score = pace
      ? pace.expiring * 2 +
        pace.spare / 4 +
        (request.tier === tier ? 15 : 0) +
        (order.length - rank) * 3
      : -10 - rank - Number(entry.accountId === null)
    candidates.push({ usage: entry, route, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  const [first, ...rest] = candidates
  if (first) {
    return { status: 'routed', route: first.route, alternatives: rest.map((c) => c.route) }
  }
  return {
    status: 'exhausted',
    reason: `No ${order.join(', ')} account${request.tier ? ` of tier ${request.tier} or higher` : ''} is under ${preferences.maxUsedPercent}% used and working.`,
    usage: usage.filter((entry) => order.includes(entry.agent))
  }
}
