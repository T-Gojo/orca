import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { callMistralAccounts } from '@/runtime/runtime-mistral-accounts-client'
import type { MistralAccountState } from '../../../shared/mistral-account-types'
import type { AgentLaunchAccount } from './agent-launch-accounts'

const LOCAL_OWNER = { kind: 'local' } as const

/**
 * Fork: saved Mistral Vibe accounts on this machine, read while the menu is open (FORK.md section
 * 10). Mistral Vibe is pin-mode — there is no Switch RPC to run — so a picked account is injected
 * into the new terminal's environment by the launch, not here. Empty unless there is a choice to
 * make (kiro's rule: two saved accounts), System default first: it follows whatever key the
 * environment, `$VIBE_HOME/.env` or the keychain already provides.
 */
export function useMistralLaunchAccounts(enabled: boolean): AgentLaunchAccount[] {
  const t = useTranslate()
  const [state, setState] = useState<MistralAccountState | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    callMistralAccounts(LOCAL_OWNER, 'List').then(
      (next) => {
        if (!cancelled) {
          setState(next)
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
      label: account.planName ? `${account.customer} · ${account.planName}` : account.customer,
      selected: false
    }))
  ]
}
