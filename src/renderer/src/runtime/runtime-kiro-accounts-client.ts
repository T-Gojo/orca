import type { KiroAccountState } from '../../../shared/kiro-account-types'
import { KIRO_ACCOUNTS_RUNTIME_CAPABILITY } from '../../../shared/account-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { assertRuntimeEnvironmentCapability } from './rpc/compatibility/runtime-capability-proof'
import { callRuntimeRpc } from './rpc/calls/runtime-rpc-call'

export type KiroAccountAction = 'List' | 'AddCurrent' | 'BeginSignIn' | 'Select' | 'Remove'

export async function callKiroAccounts(
  owner: RuntimeClientTarget,
  action: KiroAccountAction,
  accountId?: string
): Promise<KiroAccountState> {
  if (owner.kind === 'environment') {
    await assertRuntimeEnvironmentCapability(
      owner.environmentId,
      KIRO_ACCOUNTS_RUNTIME_CAPABILITY,
      'This execution host does not support Kiro accounts yet. Update Orca on that host.'
    )
  }
  return callRuntimeRpc(
    owner,
    `accounts.kiro${action}`,
    action === 'Select' || action === 'Remove' ? { accountId } : null,
    { timeoutMs: 20_000 }
  )
}
