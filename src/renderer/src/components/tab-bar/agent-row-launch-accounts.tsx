import type React from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { listAgentLaunchAccounts, type AgentLaunchAccount } from '@/lib/agent-launch-accounts'
import { useSingleLoginLaunchAccounts } from '@/lib/single-login-launch-accounts'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type { SubscribedAgentLaunchPickerMenu } from '@/components/agent/AgentLaunchPickerMenu'
import { AccountLaunchRow } from './AccountLaunchRow'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

export type AgentRowLaunchAccounts = {
  accounts: AgentLaunchAccount[]
  heading?: string
  launch: (
    accountId: string | null,
    runLaunch: (row: NewTabAgentMenuRow, launchAccountId?: string | null) => void
  ) => void
}

// Account pins and switches route this machine's CLI; a remote host keeps its own logins.
function isLocalTerminalRow(row: NewTabAgentMenuRow): boolean {
  return (
    (row.kind === 'terminal' || row.kind === 'cli') &&
    (row.executionHostId ?? LOCAL_EXECUTION_HOST_ID) === LOCAL_EXECUTION_HOST_ID
  )
}

/** Saved accounts a menu row can launch on, or null when the row launches without a choice. */
function useAgentRowLaunchAccounts(
  rows: readonly NewTabAgentMenuRow[]
): (row: NewTabAgentMenuRow) => AgentRowLaunchAccounts | null {
  const settings = useAppStore((s) => s.settings)
  const singleLoginAccounts = useSingleLoginLaunchAccounts(
    rows.filter(isLocalTerminalRow).map((row) => row.agent)
  )
  return (row) => {
    if (!isLocalTerminalRow(row)) {
      return null
    }
    const singleLogin = singleLoginAccounts(row.agent)
    if (singleLogin) {
      return singleLogin.accounts.length === 0
        ? null
        : {
            accounts: singleLogin.accounts,
            heading: translate(
              'auto.components.tab.bar.QuickLaunchButton.switchAccountAndOpen',
              'Switch account and open'
            ),
            launch: (accountId, runLaunch) =>
              void singleLogin
                .switchTo(singleLogin.accounts, accountId)
                .then((switched) => switched && runLaunch(row))
          }
    }
    const accounts = listAgentLaunchAccounts(
      row.agent,
      settings,
      translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
    )
    return accounts.length === 0
      ? null
      : { accounts, launch: (accountId, runLaunch) => runLaunch(row, accountId) }
  }
}

type PickerLaunch = React.ComponentProps<typeof SubscribedAgentLaunchPickerMenu>['runLaunch']

/** The picker's launch, plus the saved account an account row picked (null: System default). */
export type AccountAwareLaunch = (
  ...args: [...Parameters<PickerLaunch>, launchAccountId?: string | null]
) => boolean | Promise<boolean>

/** Renders a row's account submenu, or null when the row launches without a choice. */
export function useAgentRowAccountLaunch(
  rows: readonly NewTabAgentMenuRow[],
  disabled: boolean,
  runLaunch: AccountAwareLaunch
): (row: NewTabAgentMenuRow, title: string, children: React.ReactNode) => React.JSX.Element | null {
  const rowAccounts = useAgentRowLaunchAccounts(rows)
  return (row, title, children) => {
    const account = rowAccounts(row)
    return account ? (
      <AccountLaunchRow
        accounts={account.accounts}
        disabled={disabled}
        title={title}
        {...(account.heading ? { heading: account.heading } : {})}
        onLaunch={(accountId) =>
          account.launch(accountId, (launchRow, launchAccountId) =>
            runLaunch(launchRow, undefined, undefined, undefined, launchAccountId)
          )
        }
      >
        {children}
      </AccountLaunchRow>
    ) : null
  }
}
