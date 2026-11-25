import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationPreferences,
  DelegationRoute
} from '../../shared/delegation/delegation-types'
import { DELEGATION_AGENTS } from '../../shared/delegation/delegation-types'
import { accountPace } from './delegation-pace'
import { delegationAccountKey, routeDelegation } from './delegation-route'

const SHORT_WINDOW = { session: '5h', weekly: 'week', monthly: 'month' } as const

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 48
    ? `${hours}h${minutes % 60 ? `${minutes % 60}m` : ''}`
    : `${Math.round(hours / 24)}d`
}

function windowsText(entry: DelegationAccountUsage, now: number): string {
  if (!entry.windows.length) {
    return 'usage unread'
  }
  return entry.windows
    .map((window) => {
      if (window.resetsAt !== null && window.resetsAt <= now) {
        return `${SHORT_WINDOW[window.name]} reset`
      }
      const reset = window.resetsAt ? ` ↻${formatDuration(window.resetsAt - now)}` : ''
      return `${SHORT_WINDOW[window.name]} ${Math.round(window.usedPercent)}%${reset}`
    })
    .join(' · ')
}

function accountName(entry: Pick<DelegationAccountUsage, 'label' | 'accountId'>): string {
  return entry.label ?? (entry.accountId ? entry.accountId.slice(0, 8) : 'system')
}

function selfLine(self: DelegationAccountUsage | undefined, now: number, threshold: number) {
  if (!self) {
    return { line: 'You: your own usage is not known yet.', pressed: false }
  }
  const pace = accountPace(self, now)
  const runsOut = pace?.exhaustsAt
    ? `; at your pace the ${SHORT_WINDOW[pace.exhaustingWindow ?? 'session']} limit hits in ~${formatDuration(pace.exhaustsAt - now)}, before it resets`
    : ''
  const pressed = Boolean(pace?.exhaustsAt) || (self.usedPercent ?? 0) >= threshold
  const spare =
    !pressed && pace && pace.expiring >= 10
      ? `; ~${Math.round(pace.expiring)}% of yours resets unused, so work yourself too, alongside workers`
      : ''
  return {
    line: `You (${self.agent}, ${accountName(self)}): ${windowsText(self, now)}${runsOut}${spare}`,
    pressed
  }
}

function agentLines(
  preferences: DelegationPreferences,
  workers: readonly DelegationAccountUsage[],
  now: number
): string[] {
  return DELEGATION_AGENTS.flatMap((agent: DelegationAgent) => {
    const accounts = workers.filter((entry) => entry.agent === agent)
    if (!accounts.length || !preferences.agentOrder.includes(agent)) {
      return []
    }
    const profile = preferences.profiles[agent]
    const head = `- ${agent} [${profile?.tier ?? 'standard'}${profile?.note ? `, ${profile.note}` : ''}]`
    const usable = accounts
      .filter((entry) => entry.available)
      .map((entry) => ({ entry, pace: accountPace(entry, now) }))
      .sort(
        (a, b) =>
          (b.pace?.expiring ?? -1) - (a.pace?.expiring ?? -1) ||
          (b.pace?.spare ?? -1) - (a.pace?.spare ?? -1)
      )
    if (!usable.length) {
      return [`${head}: all at limit (${windowsText(accounts[0], now)})`]
    }
    const shown = usable.slice(0, 2).map(({ entry, pace }) => {
      const expiring =
        pace && pace.expiring >= 10 ? ` → ${Math.round(pace.expiring)}% resets unused` : ''
      return `${accountName(entry)}: ${windowsText(entry, now)}${expiring}`
    })
    const count = usable.length > 1 ? ` ${usable.length} usable` : ''
    return [`${head}${count}: ${shown.join('; ')}`]
  })
}

function pick(route: DelegationRoute | undefined): string {
  return route ? route.workerStartFlags.join(' ') : 'none'
}

/** What decides whether a brief says something new: shares to the nearest 5%, without reset clocks. */
function briefKey(text: string): string {
  return text
    .replace(/ ↻\S+/g, '')
    .replace(/~\S+/g, '')
    .replace(/(\d+)%/g, (_match, value: string) => `${Math.round(Number(value) / 5) * 5}%`)
}

/**
 * Fork: the usage brief a coordinator agent gets with each prompt (FORK.md "Auto-delegation"):
 * its own windows and pace, each worker agent's best accounts with reset clocks and quota that
 * would reset unused, capability tiers, and the best light and strong route. `key` changes only
 * when the brief says something materially new. Empty when the user turned it off.
 */
export function buildDelegationAdvice(
  preferences: DelegationPreferences,
  usage: readonly DelegationAccountUsage[],
  self: { agent: DelegationAgent; accountId?: string | null },
  now = Date.now()
): { advice: string; key: string } {
  const { enabled, ownUsedPercent } = preferences.autoDelegation
  if (!enabled) {
    return { advice: '', key: '' }
  }
  const mine =
    self.accountId === undefined
      ? usage.find((entry) => entry.agent === self.agent && entry.active)
      : usage.find((entry) => entry.agent === self.agent && entry.accountId === self.accountId)
  const ownKey = mine ? delegationAccountKey(mine) : null
  const workers = usage.filter((entry) => delegationAccountKey(entry) !== ownKey)
  const { line, pressed } = selfLine(mine, now, ownUsedPercent)
  const best = (tier: 'light' | 'strong') => {
    const result = routeDelegation(preferences, workers, { tier, now })
    return result.status === 'routed' ? result.route : undefined
  }
  const light = best('light')
  const strong = best('strong')
  const lines = [
    '[Orca usage brief · auto-delegation on · user’s goal: use every account’s 5h and weekly quota before it resets]',
    line,
    ...agentLines(preferences, workers, now),
    `Best: light → ${pick(light)} · strong → ${pick(strong)}`,
    !light && !strong
      ? 'No worker has quota: do the work yourself.'
      : pressed
        ? 'You are short on quota: delegate all briefable work; keep planning, the delicate core and verification.'
        : 'Judge per task (agent-delegation skill): delegate briefable work by tier, spending quota that resets unused before yours; keep quick, conversation-bound or tight-debug work, and take over after two failed attempts. Do not ask the user.'
  ]
  const advice = lines.join('\n')
  return { advice, key: briefKey(advice) }
}
