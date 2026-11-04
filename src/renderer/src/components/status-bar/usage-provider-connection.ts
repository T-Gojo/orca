import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { isTuiAgentEnabled } from '../../../../shared/agent-launch/catalog/tui-agent-selection'
import { getVisibleUsageProvider } from './status-bar-provider-visibility'

type UsageProviderId = ProviderRateLimits['provider']

// MiniMax is a usage account, not a CLI agent, so only its sign-in decides.
const PROVIDER_AGENT: Partial<Record<UsageProviderId, TuiAgent>> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  'opencode-go': 'opencode',
  kimi: 'kimi',
  antigravity: 'antigravity',
  grok: 'grok',
  cursor: 'cursor',
  zcode: 'zcode',
  kiro: 'kiro'
}

/** No login to read, as opposed to a login whose reading failed this time. */
function isSignedOut(limits: ProviderRateLimits | null | undefined): boolean {
  const kind = limits?.status === 'error' ? limits.usageMetadata?.failureKind : undefined
  if (kind === 'missing-credentials') {
    return true
  }
  // These two report an expired login this way; Claude and Codex use it for a live session.
  return kind === 'stale-token' && (limits?.provider === 'cursor' || limits?.provider === 'minimax')
}

/** Agents turned off in Settings → Agents, and providers with no login, stay out of usage. */
export function isUsageProviderHidden(
  providerId: UsageProviderId,
  limits: ProviderRateLimits | null | undefined,
  disabledAgents: Iterable<unknown> | null | undefined
): boolean {
  const agent = PROVIDER_AGENT[providerId]
  return (agent !== undefined && !isTuiAgentEnabled(agent, disabledAgents)) || isSignedOut(limits)
}

/** getVisibleUsageProvider that also drops agents turned off or signed out. */
export function visibleUnlessHidden(
  disabledAgents: Iterable<unknown> | null | undefined
): typeof getVisibleUsageProvider {
  return (id, provider, settings) =>
    isUsageProviderHidden(id, provider, disabledAgents)
      ? null
      : getVisibleUsageProvider(id, provider, settings)
}
