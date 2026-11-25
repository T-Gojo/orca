import {
  MISTRAL_TERMINAL_ACCOUNT_PIN_ENV,
  readTerminalAccountPin,
  withoutTerminalAccountPin
} from '../../shared/agent-terminal-account-pin'
import { getMistralAccountService } from './mistral-account-host'

/**
 * Fork: which machine this spawn runs on. Host terminals only: a WSL spawn keeps the distro's own
 * key setup, so the pin hint is dropped there (the same rule as Claude's terminal pin). `runtime`
 * is optional the codex lane's way: an unset runtime is a host spawn.
 */
export type MistralAccountSelectionTarget = { runtime?: 'host' | 'wsl' }

/** The account id named by ORCA_PIN_MISTRAL_ACCOUNT; null is System default, undefined unpinned. */
export function readMistralTerminalAccountPin(
  env: Record<string, string | undefined> | undefined
): string | null | undefined {
  return readTerminalAccountPin(env, MISTRAL_TERMINAL_ACCOUNT_PIN_ENV)
}

/**
 * Fork: applies a Mistral Vibe terminal account pin (FORK.md section 10). The saved account's API
 * key is injected as MISTRAL_API_KEY — env outranks `$VIBE_HOME/.env` and the keyring — and the
 * hint is stripped so a nested shell never re-applies it. An unpinned or System-default spawn is
 * returned as-is: it follows whatever key the environment already provides.
 */
export async function applyMistralTerminalAccountPin(
  env: Record<string, string> | undefined,
  target: MistralAccountSelectionTarget
): Promise<Record<string, string> | undefined> {
  const stripped = withoutTerminalAccountPin(env, MISTRAL_TERMINAL_ACCOUNT_PIN_ENV)
  const accountId = readMistralTerminalAccountPin(env)
  if (accountId === undefined || accountId === null || target.runtime === 'wsl') {
    return stripped
  }
  const apiKey = await getMistralAccountService().readAccountApiKey(accountId)
  if (!apiKey) {
    // Same refusal as Claude's pin: a stale pin must not silently launch on another account.
    throw new Error('That Mistral account is no longer saved in Orca.')
  }
  return { ...stripped, MISTRAL_API_KEY: apiKey }
}
