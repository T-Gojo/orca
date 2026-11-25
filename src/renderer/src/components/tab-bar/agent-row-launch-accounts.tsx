import type React from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { listAgentLaunchAccounts, type AgentLaunchAccount } from '@/lib/agent-launch-accounts'
import { useSingleLoginLaunchAccounts } from '@/lib/single-login-launch-accounts'
import { useMistralLaunchAccounts } from '@/lib/mistral-launch-accounts'
import { useOpenCodeLaunchAccounts } from '@/lib/use-openencode-launch-accounts'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type { AgentPickerMenuLaunch } from '@/components/agent/AgentLaunchPickerMenuRow'
import { AccountLaunchRow } from './AccountLaunchRow'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'

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
  const t = useTranslate()
  const settings = useAppStore((s) => s.settings)
  const singleLoginAccounts = useSingleLoginLaunchAccounts(
    rows.filter(isLocalLaunchRow).map((row) => row.agent)
  )
  // Fork: mistral-vibe is pin-mode (FORK.md section 10): its saved accounts come from the vault
  // RPC like a single-login agent's do, but the pick pins the terminal's env, never a login.
  const mistralAccounts = useMistralLaunchAccounts(
    rows.some((row) => isLocalLaunchRow(row) && row.agent === 'mistral-vibe')
  )
  // Fork (FORK.md section 11): opencode/opencode2 are pin-mode on their managed data accounts.
  const openCodeAccounts = useOpenCodeLaunchAccounts(
    rows.some(
      (row) => isLocalLaunchRow(row) && (row.agent === 'opencode' || row.agent === 'opencode2')
    )
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
            heading: t(
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
    // Fork (FORK.md section 10): the mistral-vibe pick pins the launch's terminal env.
    if (row.agent === 'mistral-vibe') {
      return mistralAccounts.length === 0 ? null : { accounts: mistralAccounts }
    }
    // Fork (FORK.md section 11): the opencode pick pins the launch onto the managed account's store.
    if (row.agent === 'opencode' || row.agent === 'opencode2') {
      return openCodeAccounts.length === 0 ? null : { accounts: openCodeAccounts }
    }
    const accounts = listAgentLaunchAccounts(
      row.agent,
      settings,
      t('auto.components.status.bar.StatusBar.c676918adc', 'System default')
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

/** The picker's launch, plus the saved account an account row picked (null: System default). */
export type AccountAwareLaunch = (
  ...args: [...Parameters<AgentPickerMenuLaunch>, launchAccountId?: string | null]
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
            runLaunch(row, undefined, undefined, launchAccountId)
          )
        }
      >
        {children}
      </AccountLaunchRow>
    ) : null
  }
}
