import { useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { launchOnAccount, useAgentRowLaunchAccounts } from '../tab-bar/agent-row-launch-accounts'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type {
  AgentPickerEntry,
  AgentPickerSurface
} from '../../../../shared/agent-launch/picker/agent-launch-picker'

type Result = boolean | void | Promise<boolean>

// The rows the picker launches; built here because importing the picker menu would be circular.
function launchRow(entry: AgentPickerEntry, surface: AgentPickerSurface): NewTabAgentMenuRow {
  return {
    agent: entry.agent,
    kind: surface === 'chat' ? 'chat' : 'cli',
    executionHostId: entry.rows[0]?.executionHostId
  }
}

/** The setup panel's account choice: a row to render and a launch that applies it. */
export function useAgentLaunchAccountChoice(
  entry: AgentPickerEntry,
  disabled: boolean | undefined
): {
  row: React.JSX.Element | null
  launch: (surface: AgentPickerSurface, run: (launchAccountId?: string | null) => Result) => Result
} {
  const rows = useMemo(() => entry.surfaces.map((surface) => launchRow(entry, surface)), [entry])
  const accountsFor = useAgentRowLaunchAccounts(rows)
  // Undefined until picked, so an untouched panel launches exactly as before.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  // A terminal can take any account; a chat only one reached by switching the agent's login.
  const account = rows.map(accountsFor).find((found) => found !== null) ?? null
  if (!account) {
    return { row: null, launch: (_surface, run) => run() }
  }
  const shownId = picked !== undefined ? picked : account.accounts.find((a) => a.selected)?.id
  const shown = account.accounts.find((a) => a.id === shownId) ?? account.accounts[0]
  return {
    row: (
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {translate('agentPicker.account', 'Account')}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={translate('agentPicker.accountLabel', '{{agent}} account', {
                agent: entry.label
              })}
              className="min-w-0 max-w-full"
            >
              <span className="min-w-0 truncate text-xs">{shown?.label}</span>
              <ChevronDown className="size-3 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8} className="max-w-[20rem]">
            {account.accounts.map((option) => (
              <DropdownMenuItem
                key={option.id ?? 'system-default'}
                onSelect={() => setPicked(option.id)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.id === shown?.id ? (
                  <Check className="size-3.5 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
    launch: (surface, run) => {
      const target = accountsFor(launchRow(entry, surface))
      return picked === undefined || !target
        ? run()
        : Promise.resolve(launchOnAccount(target, picked, run)).then((result) => result !== false)
    }
  }
}
