import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { ManagedDataAccountsState } from '../../../shared/agent-accounts/managed-account-types'
import type { AgentLaunchAccount } from './agent-launch-accounts'

const LOCAL_OWNER = { kind: 'local' } as const

/**
 * Fork: OpenCode's managed data accounts on this machine, read while the menu is open (FORK.md
 * section 11). Pin-mode like mistral-vibe: the pick rides the launch as a per-terminal pin; the
 * global selection in Settings keeps applying to unpicked launches. Empty unless there is a
 * choice to make (kiro's rule: two saved accounts), System default first: it asks for the user's
 * own store instead of the active account's.
 */
export function useOpenCodeLaunchAccounts(enabled: boolean): AgentLaunchAccount[] {
  const t = useTranslate()
  const [state, setState] = useState<ManagedDataAccountsState | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    callRuntimeRpc<{ opencode?: ManagedDataAccountsState }>(
      LOCAL_OWNER,
      'accounts.listData',
      undefined,
      { timeoutMs: 20_000 }
    ).then(
      (snapshot) => {
        if (!cancelled) {
          setState(snapshot.opencode ?? null)
        }
      },
      () => {
        // No saved accounts or an older host: the row keeps its one-click launch.
      }
    )
    return () => {
      cancelled = true
    }
  }, [enabled])
  if (!state || state.accounts.length < 2) {
    return []
  }
  return [
    {
      id: null,
      label: t('auto.components.status.bar.StatusBar.c676918adc', 'System default'),
      selected: true
    },
    ...state.accounts.map((account) => ({
      id: account.id,
      label: account.label,
      selected: false
    }))
  ]
}
