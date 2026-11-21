import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationRouteResult
} from '../../shared/delegation/delegation-types'
import { isDelegationAgent } from '../../shared/delegation/delegation-types'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { buildDelegationUsage } from './delegation-usage'
import { readDelegationPreferences } from './delegation-preferences'
import { routeDelegation, type DelegationRouteRequest } from './delegation-route'
import { delegationAccountEnv } from './delegation-account-env'

type DelegationRuntime = Pick<
  OrcaRuntimeService,
  'getAccountsSnapshot' | 'refreshAccountsForMobile'
>

/** Every delegation agent's accounts with their usage; `refresh` reads usage fresh first. */
export async function readDelegationUsage(
  runtime: DelegationRuntime,
  options: { refresh?: boolean } = {}
): Promise<{ usage: DelegationAccountUsage[]; readAt: number }> {
  if (options.refresh) {
    await runtime.refreshAccountsForMobile()
  }
  const [snapshot, preferences, antigravity, kiro] = await Promise.all([
    runtime.getAccountsSnapshot(),
    readDelegationPreferences(),
    getAntigravityAccountService({ runtime: 'host' })
      .then((service) => service.listAccounts())
      .then((state) => state.accounts)
      .catch(() => []),
    getKiroAccountService()
      .listAccounts()
      .then((state) => state.accounts)
      .catch(() => [])
  ])
  return {
    usage: buildDelegationUsage({
      rateLimits: snapshot.rateLimits,
      claude: snapshot.claude,
      codex: snapshot.codex,
      antigravity,
      kiro,
      maxUsedPercent: preferences.maxUsedPercent
    }),
    readAt: Date.now()
  }
}

const STALE_READING_MS = 5 * 60_000
let lastBackgroundRefreshAt = 0

/** Reads usage fresh in the background when the last readings are stale, so the next brief is current
 *  without making this one wait. At most once per stale period. */
export function refreshDelegationUsageSoon(
  runtime: DelegationRuntime,
  usage: readonly DelegationAccountUsage[],
  now = Date.now()
): void {
  const stale = usage.some(
    (entry) => entry.readAt === null || now - entry.readAt > STALE_READING_MS
  )
  if (!stale || now - lastBackgroundRefreshAt < STALE_READING_MS) {
    return
  }
  lastBackgroundRefreshAt = now
  void runtime.refreshAccountsForMobile().catch(() => undefined)
}

export async function routeDelegationTask(
  runtime: DelegationRuntime,
  request: DelegationRouteRequest & { refresh?: boolean }
): Promise<DelegationRouteResult> {
  const [{ usage }, preferences] = await Promise.all([
    readDelegationUsage(runtime, { refresh: request.refresh }),
    readDelegationPreferences()
  ])
  return routeDelegation(preferences, usage, request)
}

/** Resolves `--account` (an id, email, `system`, or `auto`) to one of the agent's accounts. */
export async function resolveDelegationAccount(
  runtime: DelegationRuntime,
  agent: string,
  reference: string
): Promise<{ agent: DelegationAgent; accountId: string | null; label: string | null }> {
  if (!isDelegationAgent(agent)) {
    throw new Error(
      `--account works with claude, codex, antigravity and kiro workers, not ${agent}.`
    )
  }
  if (reference === 'auto') {
    const routed = await routeDelegationTask(runtime, { agent, refresh: true })
    if (routed.status !== 'routed') {
      throw new Error(routed.reason)
    }
    return { agent, accountId: routed.route.accountId, label: routed.route.accountLabel }
  }
  const { usage } = await readDelegationUsage(runtime)
  const accounts = usage.filter((entry) => entry.agent === agent)
  if (reference === 'system') {
    const system = accounts.find((entry) => entry.accountId === null)
    if (!system) {
      throw new Error(`${agent} has no system login to use; name a saved account.`)
    }
    return { agent, accountId: null, label: system.label }
  }
  const wanted = reference.toLowerCase()
  const matches = accounts.filter(
    (entry) => entry.accountId === reference || entry.label?.toLowerCase() === wanted
  )
  if (matches.length !== 1) {
    const known = accounts.map((entry) => entry.label ?? entry.accountId ?? 'system').join(', ')
    throw new Error(
      matches.length === 0
        ? `No ${agent} account matches "${reference}". Saved: ${known || 'none'}.`
        : `"${reference}" matches several ${agent} accounts; pass the account id.`
    )
  }
  return { agent, accountId: matches[0].accountId, label: matches[0].label }
}

/** The env a worker needs to run on `--account`. */
export async function delegationWorkerEnv(
  runtime: DelegationRuntime,
  agent: string,
  reference: string
): Promise<{ env: Record<string, string>; accountId: string | null; label: string | null }> {
  const account = await resolveDelegationAccount(runtime, agent, reference)
  return {
    env: await delegationAccountEnv(account.agent, account.accountId),
    accountId: account.accountId,
    label: account.label
  }
}
