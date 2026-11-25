import type { MistralAccountState } from '../../../shared/mistral-account-types'
import { MISTRAL_ACCOUNTS_RUNTIME_CAPABILITY } from '../../../shared/remote-runtime/protocol/account-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { assertRuntimeEnvironmentCapability } from './rpc/compatibility/runtime-capability-proof'
import { callRuntimeRpc } from './rpc/calls/runtime-rpc-call'

// Fork: Mistral Vibe accounts (FORK.md section 10). Pin-mode, so there is no Select action: a
// picked account is pinned per terminal at launch, never switched globally.
export type MistralAccountAction = 'List' | 'AddCurrent' | 'Remove'

export async function callMistralAccounts(
  owner: RuntimeClientTarget,
  action: MistralAccountAction,
  accountId?: string
): Promise<MistralAccountState> {
  if (owner.kind === 'environment') {
    await assertRuntimeEnvironmentCapability(
      owner.environmentId,
      MISTRAL_ACCOUNTS_RUNTIME_CAPABILITY,
      'This execution host does not support Mistral Vibe accounts yet. Update Orca on that host.'
    )
  }
  return callRuntimeRpc(
    owner,
    `accounts.mistral${action}`,
    action === 'Remove' ? { accountId } : null,
    { timeoutMs: 20_000 }
  )
}
