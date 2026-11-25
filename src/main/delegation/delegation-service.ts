import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type {
  DelegationAccountUsage,
  DelegationAgent,
  DelegationRouteResult
} from '../../shared/delegation/delegation-types'
import { isDelegationAgent } from '../../shared/delegation/delegation-types'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { readKiroCliWhoamiEmail } from '../kiro/kiro-cli-whoami'
// Fork: mistral-vibe joins the delegation tables (FORK.md §8).
import { getMistralAccountService } from '../mistral/mistral-account-host'
import type { MistralAccountState } from '../../shared/mistral-account-types'
// Fork: opencode joins too, on upstream's managed data accounts (FORK.md §8).
import { readOpenCodeDelegationAccounts } from '../rate-limits/opencode-account-usage-probe'
import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
import { buildDelegationUsage } from './delegation-usage'
import { readDelegationPreferences } from './delegation-preferences'
import { routeDelegation, type DelegationRouteRequest } from './delegation-route'
import { delegationAccountEnv } from './delegation-account-env'

type DelegationRuntime = Pick<
  OrcaRuntimeService,
  'getAccountsSnapshot' | 'refreshAccountsForMobile'
>

const WHOAMI_REUSE_MS = 10 * 60_000
let kiroWhoami: { login: string; email: string | null; readAt: number } | null = null
let kiroWhoamiInFlight = false

/**
 * Fork: mistral-vibe's saved accounts for the delegation table — the whoami customer label is the
 * account's "email" — plus the machine's own key as the `--account system` row when it matches no
 * saved account (the delegation usage input takes both).
 */
function mistralUsageInput(state: MistralAccountState): {
  accounts: readonly { id: string; email: string | null }[]
  systemLogin: { label: string | null } | null
} {
  const machineKey = state.currentAccount
  const matched =
    machineKey &&
    state.accounts.some((account) => account.keyFingerprint === machineKey.keyFingerprint)
  return {
    accounts: state.accounts.map((account) => ({ id: account.id, email: account.customer })),
    systemLogin:
      machineKey && !matched
        ? { label: machineKey.identityKnown ? machineKey.customer : null }
        : null
  }
}

/** The email of kiro-cli's current login, read with `kiro-cli whoami` in the background and kept per
 *  login, so a login switched outside Orca gets its own email without a prompt waiting on it. */
function kiroLoginEmail(limits: ProviderRateLimits | null): string | null {
  const login = limits?.usageMetadata?.authProvenance ?? 'unknown'
  const known = kiroWhoami?.login === login ? kiroWhoami : null
  if ((!known || Date.now() - known.readAt > WHOAMI_REUSE_MS) && limits && !kiroWhoamiInFlight) {
    kiroWhoamiInFlight = true
    void readKiroCliWhoamiEmail()
      .then((email) => {
        kiroWhoami = { login, email, readAt: Date.now() }
      })
      .finally(() => {
        kiroWhoamiInFlight = false
      })
  }
  return known?.email ?? null
}

/** Every delegation agent's accounts with their usage; `refresh` reads usage fresh first. */
export async function readDelegationUsage(
  runtime: DelegationRuntime,
  options: { refresh?: boolean } = {}
): Promise<{ usage: DelegationAccountUsage[]; readAt: number }> {
  if (options.refresh) {
    await runtime.refreshAccountsForMobile()
  }
  const [snapshot, preferences, antigravity, kiro, mistral, openCode] = await Promise.all([
    runtime.getAccountsSnapshot(),
    readDelegationPreferences(),
    getAntigravityAccountService({ runtime: 'host' })
      .then((service) => service.listAccounts())
      .then((state) => state.accounts)
      .catch(() => []),
    getKiroAccountService()
      .listAccounts()
      .then((state) => state.accounts)
      .catch(() => []),
    getMistralAccountService()
      .listAccounts()
      .catch(() => null),
    readOpenCodeDelegationAccounts().catch(() => null)
  ])
  const mistralUsage = mistral ? mistralUsageInput(mistral) : { accounts: [], systemLogin: null }
  const openCodeUsage = openCode ?? { accounts: [], systemLogin: null }
  return {
    usage: buildDelegationUsage({
      rateLimits: snapshot.rateLimits,
      claude: snapshot.claude,
      codex: snapshot.codex,
      antigravity,
      kiro,
      kiroLoginEmail: kiroLoginEmail(snapshot.rateLimits.kiro),
      mistral: mistralUsage.accounts,
      mistralSystemLogin: mistralUsage.systemLogin,
      openCode: openCodeUsage.accounts,
      openCodeSystemLogin: openCodeUsage.systemLogin,
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
      // Fork: mistral-vibe and opencode join the --account agents (FORK.md §8).
      `--account works with claude, codex, antigravity, kiro, mistral-vibe and opencode workers, not ${agent}.`
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
