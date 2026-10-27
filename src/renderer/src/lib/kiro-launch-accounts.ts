import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callKiroAccounts } from '@/runtime/runtime-kiro-accounts-client'
import type { KiroAccountState } from '../../../shared/kiro-account-types'
import type { AgentLaunchAccount } from './agent-launch-accounts'

const LOCAL_OWNER = { kind: 'local' } as const

/**
 * Saved Kiro accounts on this machine, read while the menu is open. Empty unless there is a
 * choice to make: kiro-cli keeps one login, so picking an account switches it for new sessions.
 */
export function useKiroLaunchAccounts(enabled: boolean): AgentLaunchAccount[] {
  const [state, setState] = useState<KiroAccountState | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    callKiroAccounts(LOCAL_OWNER, 'List').then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      () => {
        // No saved accounts or no kiro-cli here: the row keeps its one-click launch.
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
    label: account.email ?? translate('accounts.kiro.saved', 'Saved Kiro account'),
    selected: account.id === state.activeAccountId
  }))
}

/** Switches kiro-cli's login to `accountId` before a launch; false when the switch failed. */
export async function switchKiroAccountForLaunch(
  accounts: AgentLaunchAccount[],
  accountId: string | null
): Promise<boolean> {
  const account = accounts.find((entry) => entry.id === accountId)
  if (!account || !accountId || account.selected) {
    return true
  }
  try {
    await callKiroAccounts(LOCAL_OWNER, 'Select', accountId)
    toast(
      translate('accounts.kiro.switched', 'Kiro switched to {{value0}}', {
        value0: account.label
      }),
      {
        description: translate(
          'accounts.kiro.switchedAll',
          'kiro-cli keeps one login, so new kiro-cli sessions use this account. Running ones keep theirs until restarted.'
        )
      }
    )
    return true
  } catch (error) {
    toast.error(translate('accounts.kiro.switchFailed', 'Could not switch Kiro account'), {
      description: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
