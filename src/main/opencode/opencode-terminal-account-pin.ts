import {
  OPENCODE_TERMINAL_ACCOUNT_PIN_ENV,
  readTerminalAccountPin,
  withoutTerminalAccountPin
} from '../../shared/agent-terminal-account-pin'
import {
  MANAGED_DATA_ACCOUNT_RESUME_ENV,
  SYSTEM_DATA_ACCOUNT_RESUME_ID
} from '../../shared/agent-launch/environment/managed-data-account-resume'
import { getManagedDataAccountService } from '../managed-data-accounts/service'

/**
 * Fork: which machine this spawn runs on. Host terminals only: a WSL spawn keeps the distro's own
 * store, so the pin hint is dropped there (the same rule as Claude's and Mistral's terminal pins).
 */
export type OpenCodeAccountSelectionTarget = { runtime?: 'host' | 'wsl' }

/** The account id named by ORCA_PIN_OPENCODE_ACCOUNT; null is System default, undefined unpinned. */
export function readOpenCodeTerminalAccountPin(
  env: Record<string, string | undefined> | undefined
): string | null | undefined {
  return readTerminalAccountPin(env, OPENCODE_TERMINAL_ACCOUNT_PIN_ENV)
}

/**
 * Fork: applies an OpenCode terminal account pin (FORK.md section 11). The account rides upstream's
 * own per-launch store request: `ORCA_DATA_ACCOUNT_ID` names the managed account's data home, which
 * the pty host-env assembly turns into the account's XDG overlay; `system` asks for the user's own
 * store, so the active account's overlay does not apply. The hint is stripped so a nested shell
 * never re-applies it; an unpinned spawn follows the active account as before.
 */
export async function applyOpenCodeTerminalAccountPin(
  env: Record<string, string> | undefined,
  target: OpenCodeAccountSelectionTarget
): Promise<Record<string, string> | undefined> {
  const stripped = withoutTerminalAccountPin(env, OPENCODE_TERMINAL_ACCOUNT_PIN_ENV)
  const accountId = readOpenCodeTerminalAccountPin(env)
  if (accountId === undefined || target.runtime === 'wsl') {
    return stripped
  }
  if (accountId !== null) {
    const known = getManagedDataAccountService()
      .list('opencode')
      .accounts.some((account) => account.id.toLowerCase() === accountId.toLowerCase())
    if (!known) {
      // Same refusal as Claude's pin: a stale pin must not silently launch on another account.
      throw new Error('That OpenCode account is no longer saved in Orca.')
    }
  }
  return {
    ...stripped,
    [MANAGED_DATA_ACCOUNT_RESUME_ENV]: accountId ?? SYSTEM_DATA_ACCOUNT_RESUME_ID
  }
}
