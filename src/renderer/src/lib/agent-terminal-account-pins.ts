import {
  CLAUDE_TERMINAL_ACCOUNT_PIN_ENV,
  CODEX_TERMINAL_ACCOUNT_PIN_ENV,
  encodeTerminalAccountPin
} from '../../../shared/agent-terminal-account-pin'
import type { TuiAgent } from '../../../shared/tui-agent'

// Why in memory: main keeps the pin itself in the pane's env; this only keeps account-switch
// prompts from offering to move a terminal the user opened on purpose for another account.
const pinnedTabIds = new Set<string>()

export function markAgentTerminalTabAccountPinned(tabId: string): void {
  pinnedTabIds.add(tabId)
}

export function isAgentTerminalTabAccountPinned(tabId: string): boolean {
  return pinnedTabIds.has(tabId)
}

/** The spawn env hint that opens this launch on `accountId`; empty for agents without accounts. */
export function agentTerminalAccountPinEnv(
  agent: TuiAgent,
  accountId: string | null
): Record<string, string> {
  if (agent === 'claude') {
    return { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: encodeTerminalAccountPin(accountId) }
  }
  if (agent === 'codex') {
    return { [CODEX_TERMINAL_ACCOUNT_PIN_ENV]: encodeTerminalAccountPin(accountId) }
  }
  return {}
}

/** The startup env field for a launch, carrying the account pin when one was picked. */
export function pinnedStartupEnv(
  env: Record<string, string> | undefined,
  agent: TuiAgent,
  accountId: string | null | undefined
): { env?: Record<string, string> } {
  const pin = accountId === undefined ? {} : agentTerminalAccountPinEnv(agent, accountId)
  const merged = Object.keys(pin).length > 0 ? { ...env, ...pin } : env
  return merged ? { env: merged } : {}
}
