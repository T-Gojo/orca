import type React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { AgentLaunchAccount } from '@/lib/agent-launch-accounts'

const SYSTEM_DEFAULT_ACCOUNT_KEY = 'system-default'

export function accountKey(accountId: string | null): string {
  return accountId ?? SYSTEM_DEFAULT_ACCOUNT_KEY
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
