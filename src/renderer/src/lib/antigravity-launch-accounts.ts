import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callAntigravityAccounts } from '@/runtime/runtime-antigravity-accounts-client'
import type { AntigravityAccountState } from '../../../shared/antigravity-account-types'
import type { AgentLaunchAccount } from './agent-launch-accounts'

const LOCAL_OWNER = { kind: 'local' } as const
const HOST_TARGET = { runtime: 'host' } as const

/**
 * Saved Antigravity accounts on this machine, read while the menu is open. Empty unless there is
 * a choice to make: agy keeps one keyring login, so picking an account switches it for every pane.
 */
export function useAntigravityLaunchAccounts(enabled: boolean): AgentLaunchAccount[] {
  const [state, setState] = useState<AntigravityAccountState | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    callAntigravityAccounts(LOCAL_OWNER, HOST_TARGET, 'List').then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      () => {
        // No saved accounts or no agy here: the row keeps its one-click launch.
      }
    )
    return () => {
      cancelled = true
    }
  }, [enabled])
  if (!state || state.accounts.length < 2) {
    return []
  }
  return state.accounts.map((account) => ({
    id: account.id,
    label:
      account.email ??
      translate('auto.components.status.bar.antigravityAccounts.unnamed', 'Antigravity account'),
    selected: account.id === state.activeAccountId
  }))
}

/** Switches Antigravity's login to `accountId` before a launch; false when the switch failed. */
export async function switchAntigravityAccountForLaunch(
  accounts: AgentLaunchAccount[],
  accountId: string | null
): Promise<boolean> {
  const account = accounts.find((entry) => entry.id === accountId)
  if (!account || !accountId || account.selected) {
    return true
  }
  try {
    await callAntigravityAccounts(LOCAL_OWNER, HOST_TARGET, 'Select', accountId)
    toast(
      translate(
        'auto.lib.antigravityLaunchAccounts.switched',
        'Antigravity switched to {{value0}}',
        {
          value0: account.label
        }
      ),
      {
        description: translate(
          'auto.lib.antigravityLaunchAccounts.switchedAll',
          'Antigravity keeps one login, so other Antigravity terminals use this account from their next request.'
        )
      }
    )
    return true
  } catch (error) {
    toast.error(
      translate(
        'auto.lib.antigravityLaunchAccounts.switchFailed',
        'Could not switch Antigravity account'
      ),
      { description: error instanceof Error ? error.message : String(error) }
    )
    return false
  }
}
