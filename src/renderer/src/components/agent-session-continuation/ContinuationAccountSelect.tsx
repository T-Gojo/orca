import type React from 'react'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentLaunchChoice } from '@/lib/agent-menu-selection'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  listAgentLaunchAccounts,
  type AgentLaunchAccount,
  type AgentLaunchAccountSettings
} from '@/lib/agent-launch-accounts'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { useSingleLoginLaunchAccounts } from '@/lib/single-login-launch-accounts'

const SYSTEM_DEFAULT_ACCOUNT_KEY = 'system-default'

export function accountKey(accountId: string | null): string {
  return accountId ?? SYSTEM_DEFAULT_ACCOUNT_KEY
}

/**
 * The hand-off's account choice on this computer. Claude and Codex pin the account for a terminal;
 * Fork: agy and kiro-cli keep one login, so their pick switches that login before any launch.
 */
export function useContinuationAccount<TRequest>({
  open,
  request,
  agent,
  choice,
  settings
}: {
  open: boolean
  request: TRequest
  agent: TuiAgent | null | undefined
  choice: AgentLaunchChoice | null | undefined
  settings: AgentLaunchAccountSettings | null | undefined
}): {
  accounts: AgentLaunchAccount[]
  value: string
  pick: (accountId: string | null) => void
  launchInput: { launchAccountId?: string | null }
  /** Switches a single-login agent to the picked account; false when that failed. */
  prepare: () => Promise<boolean>
} {
  const t = useTranslate()
  const [picked, setPicked] = useState<{
    request: TRequest
    agent: TuiAgent
    accountId: string | null
  } | null>(null)
  if (!open && picked) {
    setPicked(null)
  }
  const local = (choice?.executionHostId ?? LOCAL_EXECUTION_HOST_ID) === LOCAL_EXECUTION_HOST_ID
  const localTerminal = choice?.route === 'terminal-tui' && local
  const singleLoginFor = useSingleLoginLaunchAccounts(choice && local ? [agent] : [])
  const singleLogin = agent && choice && local ? singleLoginFor(agent) : null
  const accounts = singleLogin
    ? singleLogin.accounts
    : agent && localTerminal
      ? listAgentLaunchAccounts(
          agent,
          settings,
          t('auto.components.status.bar.StatusBar.c676918adc', 'System default')
        )
      : []
  const current =
    picked?.request === request && picked.agent === agent && accounts.length > 0 ? picked : null
  return {
    accounts,
    value: accountKey(
      current ? current.accountId : (accounts.find((account) => account.selected)?.id ?? null)
    ),
    pick: (accountId) => {
      if (agent) {
        setPicked({ request, agent, accountId })
      }
    },
    launchInput: current && !singleLogin ? { launchAccountId: current.accountId } : {},
    prepare: async () =>
      current && singleLogin ? singleLogin.switchTo(singleLogin.accounts, current.accountId) : true
  }
}

export function ContinuationAccountSelect({
  account: { accounts, value, pick: onPick }
}: {
  account: ReturnType<typeof useContinuationAccount>
}): React.JSX.Element | null {
  const t = useTranslate()
  if (accounts.length === 0) {
    return null
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium">
        {t('components.agentSessionContinuation.account', 'Account')}
      </label>
      <Select
        value={value}
        onValueChange={(next) => {
          const account = accounts.find((entry) => accountKey(entry.id) === next)
          if (account) {
            onPick(account.id)
          }
        }}
      >
        <SelectTrigger className="min-w-0 w-full" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={accountKey(account.id)} value={accountKey(account.id)}>
              {account.selected
                ? t('components.agentSessionContinuation.defaultAccount', '{{value0}} (Default)', {
                    value0: account.label
                  })
                : account.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
