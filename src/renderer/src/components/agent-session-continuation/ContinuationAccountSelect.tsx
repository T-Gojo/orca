import type React from 'react'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  listAgentLaunchAccounts,
  type AgentLaunchAccount,
  type AgentLaunchAccountSettings
} from '@/lib/agent-launch-accounts'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'

const SYSTEM_DEFAULT_ACCOUNT_KEY = 'system-default'

export function accountKey(accountId: string | null): string {
  return accountId ?? SYSTEM_DEFAULT_ACCOUNT_KEY
}

/**
 * The hand-off's account choice; offered only for a local terminal, since an account pin routes
 * this machine's CLI and chats or remote hosts sign in their own way.
 */
export function useContinuationAccount<TRequest>({
  open,
  request,
  agent,
  localTerminal,
  settings
}: {
  open: boolean
  request: TRequest
  agent: TuiAgent | null | undefined
  localTerminal: boolean
  settings: AgentLaunchAccountSettings | null | undefined
}): {
  accounts: AgentLaunchAccount[]
  value: string
  pick: (accountId: string | null) => void
  launchInput: { launchAccountId?: string | null }
} {
  const [picked, setPicked] = useState<{
    request: TRequest
    agent: TuiAgent
    accountId: string | null
  } | null>(null)
  if (!open && picked) {
    setPicked(null)
  }
  const accounts =
    agent && localTerminal
      ? listAgentLaunchAccounts(
          agent,
          settings,
          translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
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
    launchInput: current ? { launchAccountId: current.accountId } : {}
  }
}

export function ContinuationAccountSelect({
  accounts,
  value,
  onPick
}: {
  accounts: readonly AgentLaunchAccount[]
  value: string
  onPick: (accountId: string | null) => void
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium">
        {translate('components.agentSessionContinuation.account', 'Account')}
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
                ? translate(
                    'components.agentSessionContinuation.defaultAccount',
                    '{{value0}} (Default)',
                    { value0: account.label }
                  )
                : account.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
