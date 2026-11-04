import React, { useState } from 'react'
import { UserRoundCog } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { listAgentLaunchAccounts } from '@/lib/agent-launch-accounts'
import {
  resolveTabAgentAccountPane,
  restartTabAgentOnAccount
} from '@/lib/tab-agent-account-switch'

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
  const heading = translate(
    'auto.components.tab.bar.ChangeAccountMenuItems.heading',
    'Continue this session on'
  )
  // Why context-menu parts: this lives in the tab's right-click menu, not a dropdown.
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger title={label}>
          <UserRoundCog className="size-3.5 shrink-0" />
          {label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[14rem] max-w-[20rem]">
          <ContextMenuLabel>{heading}</ContextMenuLabel>
          {accounts.map((account) => {
            const current = account.id === pane.currentAccountId
            return (
              <ContextMenuItem
                key={account.id ?? 'system-default'}
                disabled={current}
                onSelect={() => restartTabAgentOnAccount(pane, account.id, account.label)}
              >
                <span className="min-w-0 flex-1 truncate">{account.label}</span>
                {current ? (
                  <ContextMenuShortcut>
                    {translate(
                      'auto.components.tab.bar.AccountLaunchRow.currentAccount',
                      'Current'
                    )}
                  </ContextMenuShortcut>
                ) : null}
              </ContextMenuItem>
            )
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  )
}
