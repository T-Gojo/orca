import React, { useState } from 'react'
import { UserRoundCog } from 'lucide-react'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { listAgentLaunchAccounts } from '@/lib/agent-launch-accounts'
import {
  resolveTabAgentAccountPane,
  restartTabAgentOnAccount
} from '@/lib/tab-agent-account-switch'
import { AccountLaunchRow } from './AccountLaunchRow'

/** "Change account" for a tab whose Claude or Codex ran out on its current account. */
export function ChangeAccountMenuItems({
  tab
}: {
  tab: { id: string; worktreeId: string }
}): React.JSX.Element | null {
  // Why captured once: the pane must not change under the pointer while the menu is open.
  const [pane] = useState(() => resolveTabAgentAccountPane(useAppStore.getState(), tab))
  const settings = useAppStore((s) => s.settings)
  if (!pane) {
    return null
  }
  const accounts = listAgentLaunchAccounts(
    pane.agent,
    settings,
    translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
  )
  if (accounts.length === 0) {
    return null
  }
  const label = translate('auto.components.tab.bar.ChangeAccountMenuItems.label', 'Change Account')
  return (
    <>
      <DropdownMenuSeparator />
      <AccountLaunchRow
        accounts={accounts}
        disabled={false}
        title={label}
        variant="default"
        heading={translate(
          'auto.components.tab.bar.ChangeAccountMenuItems.heading',
          'Continue this session on'
        )}
        currentAccountId={pane.currentAccountId}
        onLaunch={(accountId) =>
          restartTabAgentOnAccount(
            pane,
            accountId,
            accounts.find((account) => account.id === accountId)?.label ?? label
          )
        }
      >
        <UserRoundCog className="size-3.5 shrink-0" />
        {label}
      </AccountLaunchRow>
    </>
  )
}
