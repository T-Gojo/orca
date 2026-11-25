/** Fork: cross-agent delegation (FORK.md "Cross-agent delegation"). */
// 'mistral-vibe' stays last: append-only, tests and fixtures may index the earlier entries.
export const DELEGATION_AGENTS = ['antigravity', 'kiro', 'codex', 'claude', 'mistral-vibe'] as const
export type DelegationAgent = (typeof DELEGATION_AGENTS)[number]

export function isDelegationAgent(value: string): value is DelegationAgent {
  return DELEGATION_AGENTS.some((agent) => agent === value)
}

/** How hard a task an agent's model handles well: light (e.g. Gemini Flash) < standard < strong. */
export const DELEGATION_TIERS = ['light', 'standard', 'strong'] as const
export type DelegationTier = (typeof DELEGATION_TIERS)[number]

export type DelegationAgentProfile = {
  tier: DelegationTier
  /** What the agent's model is good and bad at, shown to the coordinator. */
  note?: string
}

/** Where an account stands against its plan's clock, from its windows' reset times. */
export type DelegationAccountPace = {
  /** Share usable right now: the tightest window's remaining share. */
  spare: number
  /** Share that would reset unused at an even pace: elapsed share of the window minus used share,
   *  capped by `spare`. High means use this account now. */
  expiring: number
  /** When the account runs out at its average rate so far, if that is before the window resets. */
  exhaustsAt: number | null
  exhaustingWindow: DelegationUsageWindow['name'] | null
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
  /** Capability tier and note per agent. */
  profiles: Partial<Record<DelegationAgent, DelegationAgentProfile>>
  /** Coordinators are told to delegate by default; above ownUsedPercent of their own plan, everything bulk. */
  autoDelegation: { enabled: boolean; ownUsedPercent: number }
}

export type DelegationRoute = {
  agent: DelegationAgent
  accountId: string | null
  accountLabel: string | null
  model: string | null
  usedPercent: number | null
  tier: DelegationTier
  pace: DelegationAccountPace | null
  reason: string
  /** The worker-start flags this route stands for, ready to append to a spec. */
  workerStartFlags: string[]
}

export type DelegationRouteResult =
  | { status: 'routed'; route: DelegationRoute; alternatives: DelegationRoute[] }
  | { status: 'exhausted'; reason: string; usage: DelegationAccountUsage[] }
