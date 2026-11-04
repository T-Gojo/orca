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
  /** Set for agents with one login: the launch switches that login first, then runs unpinned. */
  switchTo?: (accountId: string | null) => Promise<boolean>
}

// Account pins and switches route this machine's logins; a remote host keeps its own.
function isLocalLaunchRow(row: NewTabAgentMenuRow): boolean {
  return (
    row.kind !== 'chat-unavailable' &&
    (row.executionHostId ?? LOCAL_EXECUTION_HOST_ID) === LOCAL_EXECUTION_HOST_ID
  )
}

/** Saved accounts a menu row can launch on, or null when the row launches without a choice. */
export function useAgentRowLaunchAccounts(
  rows: readonly NewTabAgentMenuRow[]
): (row: NewTabAgentMenuRow) => AgentRowLaunchAccounts | null {
  const settings = useAppStore((s) => s.settings)
  const singleLoginAccounts = useSingleLoginLaunchAccounts(
    rows.filter(isLocalLaunchRow).map((row) => row.agent)
  )
  return (row) => {
    if (!isLocalLaunchRow(row)) {
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
            switchTo: (accountId) => singleLogin.switchTo(singleLogin.accounts, accountId)
          }
    }
    // Why terminals only: a pin is applied through the terminal's environment, which chats do not use.
    if (row.kind === 'chat') {
      return null
    }
    const accounts = listAgentLaunchAccounts(
      row.agent,
      settings,
      translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
    )
    return accounts.length === 0 ? null : { accounts }
  }
}

/** Runs `launch` on the chosen account: a switched login, or a pin passed to the launch. */
export function launchOnAccount<T>(
  account: AgentRowLaunchAccounts,
  accountId: string | null,
  launch: (launchAccountId?: string | null) => T
): T | Promise<T | false> {
  return account.switchTo
    ? account.switchTo(accountId).then((switched) => (switched ? launch() : false))
    : launch(accountId)
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
          void launchOnAccount(account, accountId, (launchAccountId) =>
            runLaunch(row, undefined, undefined, undefined, launchAccountId)
          )
        }
      >
        {children}
      </AccountLaunchRow>
    ) : null
  }
}
