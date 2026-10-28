import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { listAgentLaunchAccounts, type AgentLaunchAccount } from '@/lib/agent-launch-accounts'
import { useSingleLoginLaunchAccounts } from '@/lib/single-login-launch-accounts'
import type { NewTabAgentMenuRow } from '@/lib/new-tab-agent-menu-rows'
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
export function useAgentRowLaunchAccounts(
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
