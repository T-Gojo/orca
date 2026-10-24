/**
 * Renderer hints that pin one new agent terminal to an account instead of the global selection.
 * Main reads and removes them before the shell starts; an older main ignores them.
 */
export const CLAUDE_TERMINAL_ACCOUNT_PIN_ENV = 'ORCA_PIN_CLAUDE_ACCOUNT'
export const CODEX_TERMINAL_ACCOUNT_PIN_ENV = 'ORCA_PIN_CODEX_ACCOUNT'

export type TerminalAccountPinEnvKey =
  | typeof CLAUDE_TERMINAL_ACCOUNT_PIN_ENV
  | typeof CODEX_TERMINAL_ACCOUNT_PIN_ENV

const SYSTEM_DEFAULT_PIN = 'system-default'

/** null pins the agent's own login (System default). */
export function encodeTerminalAccountPin(accountId: string | null): string {
  return accountId ?? SYSTEM_DEFAULT_PIN
}

/** undefined: not pinned; null: System default. */
export function readTerminalAccountPin(
  env: Record<string, string | undefined> | undefined,
  key: TerminalAccountPinEnvKey
): string | null | undefined {
  const value = env?.[key]?.trim()
  if (!value) {
    return undefined
  }
  return value === SYSTEM_DEFAULT_PIN ? null : value
}

export function withoutTerminalAccountPin(
  env: Record<string, string> | undefined,
  key: TerminalAccountPinEnvKey
): Record<string, string> | undefined {
  if (!env || !(key in env)) {
    return env
  }
  const { [key]: _pin, ...rest } = env
  return rest
}
