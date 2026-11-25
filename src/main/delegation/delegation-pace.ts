import type {
  DelegationAccountPace,
  DelegationAccountUsage,
  DelegationUsageWindow
} from '../../shared/delegation/delegation-types'

const HOUR_MS = 60 * 60 * 1000
// Quota in a window that resets sooner than a worker could start using it is not worth chasing.
const MIN_USABLE_MS = 20 * 60 * 1000
const WINDOW_MS: Record<DelegationUsageWindow['name'], number> = {
  session: 5 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
  monthly: 30 * 24 * HOUR_MS
}

type WindowPace = { remaining: number; unusedAtEvenPace: number; exhaustsAt: number | null }

function windowPace(window: DelegationUsageWindow, now: number): WindowPace {
  if (window.resetsAt !== null && window.resetsAt <= now) {
    // The reading predates the reset: the window is fresh, with nothing yet at risk.
    return { remaining: 100, unusedAtEvenPace: 0, exhaustsAt: null }
  }
  const remaining = Math.max(0, 100 - window.usedPercent)
  if (window.resetsAt === null) {
    return { remaining, unusedAtEvenPace: remaining, exhaustsAt: null }
  }
  const length = WINDOW_MS[window.name]
  const elapsedMs = Math.min(length, Math.max(0, now - (window.resetsAt - length)))
  // Even pace has used elapsed/length of the plan by now; anything below that would go unused.
  const unusedAtEvenPace =
    window.resetsAt - now < MIN_USABLE_MS
      ? 0
      : Math.max(0, (elapsedMs / length) * 100 - window.usedPercent)
  const rate = elapsedMs > 0 ? window.usedPercent / elapsedMs : 0
  const runsOutAt = rate > 0 ? now + remaining / rate : null
  return {
    remaining,
    unusedAtEvenPace,
    exhaustsAt: runsOutAt !== null && runsOutAt < window.resetsAt ? runsOutAt : null
  }
}

/** Fork: how much of an account is usable now, how much would reset unused, and when it runs out. */
export function accountPace(
  usage: Pick<DelegationAccountUsage, 'windows'>,
  now: number
): DelegationAccountPace | null {
  if (!usage.windows.length) {
    return null
  }
  const paces = usage.windows.map((window) => ({ window, pace: windowPace(window, now) }))
  const spare = Math.min(...paces.map(({ pace }) => pace.remaining))
  const expiring = Math.min(spare, Math.max(...paces.map(({ pace }) => pace.unusedAtEvenPace)))
  const exhausting = paces
    .filter(({ pace }) => pace.exhaustsAt !== null)
    .sort((a, b) => (a.pace.exhaustsAt ?? 0) - (b.pace.exhaustsAt ?? 0))[0]
  return {
    spare,
    expiring,
    exhaustsAt: exhausting?.pace.exhaustsAt ?? null,
    exhaustingWindow: exhausting?.window.name ?? null
  }
}
