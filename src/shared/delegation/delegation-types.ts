/** Fork: cross-agent delegation (FORK.md "Cross-agent delegation"). */
export const DELEGATION_AGENTS = ['antigravity', 'kiro', 'codex', 'claude'] as const
export type DelegationAgent = (typeof DELEGATION_AGENTS)[number]

export function isDelegationAgent(value: string): value is DelegationAgent {
  return DELEGATION_AGENTS.some((agent) => agent === value)
}

export type DelegationUsageWindow = {
  name: 'session' | 'weekly' | 'monthly'
  usedPercent: number
  resetsAt: number | null
}

/** One account an agent can run on, with its last usage reading. */
export type DelegationAccountUsage = {
  agent: DelegationAgent
  /** Saved account id; null is the agent's own login outside Orca's saved accounts. */
  accountId: string | null
  label: string | null
  /** The login new launches of this agent use today. */
  active: boolean
  /** The highest used share across the reading's windows, 0-100; null when unread. */
  usedPercent: number | null
  windows: DelegationUsageWindow[]
  /** Unix ms of the reading; null when Orca has none yet. */
  readAt: number | null
  error: string | null
  /** Below the preferences' threshold and not failing; unread counts as available. */
  available: boolean
}

export type DelegationKindPreference = {
  agents?: DelegationAgent[]
  models?: Partial<Record<DelegationAgent, string>>
}

export type DelegationPreferences = {
  /** Agents to hand work to, first choice first. */
  agentOrder: DelegationAgent[]
  /** Model per agent; omitted agents use their own default. */
  models: Partial<Record<DelegationAgent, string>>
  /** Skip an account whose highest window is at or above this used share. */
  maxUsedPercent: number
  /** Named kinds of work (e.g. "review", "tests") with their own agent order or models. */
  kinds: Record<string, DelegationKindPreference>
}

export type DelegationRoute = {
  agent: DelegationAgent
  accountId: string | null
  accountLabel: string | null
  model: string | null
  usedPercent: number | null
  reason: string
  /** The worker-start flags this route stands for, ready to append to a spec. */
  workerStartFlags: string[]
}

export type DelegationRouteResult =
  | { status: 'routed'; route: DelegationRoute; alternatives: DelegationRoute[] }
  | { status: 'exhausted'; reason: string; usage: DelegationAccountUsage[] }
