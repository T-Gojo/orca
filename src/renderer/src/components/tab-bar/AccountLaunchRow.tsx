import React from 'react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { AgentLaunchAccount } from '@/lib/agent-launch-accounts'

// Why a submenu: two terminals in one workspace can run the same agent on different accounts.
export function AccountLaunchRow({
  accounts,
  disabled,
  title,
  onLaunch,
  children,
  heading,
  variant = 'launch',
  currentAccountId
}: {
  accounts: AgentLaunchAccount[]
  disabled: boolean
  title: string
  onLaunch: (accountId: string | null) => void
  children: React.ReactNode
  heading?: string
  variant?: 'default' | 'launch'
  /** The account the pane already runs on, marked instead of the default and not offered. */
  currentAccountId?: string | null
}): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger variant={variant} disabled={disabled} title={title}>
        {children}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[14rem] max-w-[20rem]">
        <DropdownMenuLabel>
          {heading ??
            translate(
              'auto.components.tab.bar.QuickLaunchButton.openWithAccount',
              'Open with account'
            )}
        </DropdownMenuLabel>
        {accounts.map((account) => {
          const current = currentAccountId !== undefined && account.id === currentAccountId
          return (
            <DropdownMenuItem
              key={account.id ?? 'system-default'}
              disabled={current}
              onSelect={() => onLaunch(account.id)}
            >
              <span className="min-w-0 flex-1 truncate">{account.label}</span>
              {current ? (
                <DropdownMenuShortcut>
                  {translate('auto.components.tab.bar.AccountLaunchRow.currentAccount', 'Current')}
                </DropdownMenuShortcut>
              ) : account.selected && currentAccountId === undefined ? (
                <DropdownMenuShortcut>
                  {translate('auto.components.tab.bar.QuickLaunchButton.defaultAccount', 'Default')}
                </DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
