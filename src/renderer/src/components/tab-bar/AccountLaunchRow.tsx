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
  children
}: {
  accounts: AgentLaunchAccount[]
  disabled: boolean
  title: string
  onLaunch: (accountId: string | null) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger variant="launch" disabled={disabled} title={title}>
        {children}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[14rem] max-w-[20rem]">
        <DropdownMenuLabel>
          {translate(
            'auto.components.tab.bar.QuickLaunchButton.openWithAccount',
            'Open with account'
          )}
        </DropdownMenuLabel>
        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id ?? 'system-default'}
            onSelect={() => onLaunch(account.id)}
          >
            <span className="min-w-0 flex-1 truncate">{account.label}</span>
            {account.selected ? (
              <DropdownMenuShortcut>
                {translate('auto.components.tab.bar.QuickLaunchButton.defaultAccount', 'Default')}
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
