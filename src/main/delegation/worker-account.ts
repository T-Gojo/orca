import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { WorkerStartInput } from '../runtime/rpc/methods/orchestration/worker/start/worker-start-input'
import type { AgentLaunchModeReceipt } from '../../shared/agent-launch/contracts/agent-launch-intent'
import { delegationWorkerEnv, resolveDelegationAccount } from './delegation-service'

type AccountRuntime = Pick<OrcaRuntimeService, 'getAccountsSnapshot' | 'refreshAccountsForMobile'>

function refuse(message: string): never {
  throw new OrchestrationError('invalid_argument', `${message} No effects were applied.`, {
    effectsApplied: false
  })
}

/**
 * Fork: checks `worker-start --account` before anything starts and pins `auto` to the account it
 * picked, so the start and its terminal agree on one account.
 */
export async function resolveWorkerStartAccount(
  params: WorkerStartInput,
  runtime: AccountRuntime
): Promise<WorkerStartInput> {
  if (!params.account) {
    return params
  }
  if (params.on) {
    refuse('--account picks an account on this computer; it cannot combine with --on.')
  }
  if (params.terminal) {
    refuse('--account starts a fresh agent; it cannot combine with --terminal.')
  }
  if (params.worktree === 'new-child' || params.worktree === 'new-top-level') {
    refuse('--account runs in an existing workspace; create the worktree first or omit --account.')
  }
  if (!params.agent) {
    refuse('--account needs --agent naming the agent the account belongs to.')
  }
  const account = await resolveDelegationAccount(runtime, params.agent, params.account).catch(
    (error: unknown) => refuse(error instanceof Error ? error.message : String(error))
  )
  return { ...params, account: account.accountId ?? 'system' }
}

/** An account worker runs in a terminal: chats sign in their own way, not through the account. */
export function workerAccountMode(params: WorkerStartInput): AgentLaunchModeReceipt | null {
  return params.account
    ? {
        mode: 'terminal',
        preferred: 'terminal',
        reason: 'requested',
        detail: 'Started as a terminal so it runs on the requested --account.'
      }
    : null
}

/** The env that runs this worker's agent on its `--account`; undefined without one. */
export async function workerAccountEnv(
  runtime: AccountRuntime,
  params: Pick<WorkerStartInput, 'account'>,
  agent: string
): Promise<Record<string, string> | undefined> {
  // ORCA_DELEGATION_WORKER keeps the auto-delegation hook from making a worker delegate again.
  return params.account
    ? {
        ...(await delegationWorkerEnv(runtime, agent, params.account)).env,
        ORCA_DELEGATION_WORKER: '1'
      }
    : undefined
}
