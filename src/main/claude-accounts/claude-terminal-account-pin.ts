import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  CLAUDE_TERMINAL_ACCOUNT_PIN_ENV,
  readTerminalAccountPin,
  withoutTerminalAccountPin
} from '../../shared/agent-terminal-account-pin'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../shared/claude-profile-routing'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  getClaudeProfileRouter,
  withClaudeProfileTerminalEnv
} from './claude-profile-installed-router'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { findClaudeAccount, type ClaudeAccountSelectionTarget } from './runtime-selection'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

export type ClaudeTerminalAccountPin = {
  env: Record<string, string> | undefined
  /** null when the terminal follows the global selection. */
  preparation: ClaudeRuntimeAuthPreparation | null
}

// Why a pointer per pin: the shell's claude function re-reads its pointer on every run, so a
// claude typed later in this terminal stays on the pinned account instead of the global one.
function writePinnedPointer(name: string, home: string): string {
  const dir = join(getAppEnvironment().getPath('userData'), 'claude-pinned-pointers')
  const pointer = join(dir, name)
  if (!existsSync(pointer) || readFileSync(pointer, 'utf8') !== home) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileAtomically(pointer, home, { mode: 0o600 })
  }
  return pointer
}

/**
 * Routes a terminal opened for a specific Claude account. Host terminals only: WSL and remote
 * hosts keep their own selection, and the hint is dropped so it never reaches the shell.
 */
export async function prepareClaudeTerminalAccountPin(
  env: Record<string, string> | undefined,
  target: ClaudeAccountSelectionTarget,
  settings: Pick<GlobalSettings, 'claudeManagedAccounts'> | undefined
): Promise<ClaudeTerminalAccountPin> {
  const accountId = readTerminalAccountPin(env, CLAUDE_TERMINAL_ACCOUNT_PIN_ENV)
  const stripped = withoutTerminalAccountPin(env, CLAUDE_TERMINAL_ACCOUNT_PIN_ENV)
  const router = getClaudeProfileRouter()
  if (accountId === undefined || target.runtime === 'wsl' || !router) {
    return { env: stripped, preparation: null }
  }
  // Why: the id names a folder, so only a saved host account may reach the filesystem.
  const account = accountId === null ? null : settings && findClaudeAccount(settings, accountId)
  if (account === undefined || account?.managedAuthRuntime === 'wsl') {
    throw new Error('That Claude account is no longer saved in Orca.')
  }
  // An account with no login of its own runs on System default, as a global selection would.
  const home =
    accountId === null || router.coveredBySystemDefault(accountId)
      ? null
      : await router.prepareAccount(accountId)
  const pointer = writePinnedPointer(home && accountId ? accountId : 'system-default', home ?? '')
  const routed = { ...withClaudeProfileTerminalEnv(stripped, target) }
  // Drop the global account's routing; the user's own CLAUDE_CONFIG_DIR stays for System default.
  if (routed[CLAUDE_INJECTED_CONFIG_DIR_ENV] === routed.CLAUDE_CONFIG_DIR) {
    delete routed.CLAUDE_CONFIG_DIR
  }
  delete routed[CLAUDE_INJECTED_CONFIG_DIR_ENV]
  const envPatch = {
    [CLAUDE_PROFILE_POINTER_ENV]: pointer,
    ...(home ? { CLAUDE_CONFIG_DIR: home, [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home } : {})
  }
  return {
    env: { ...routed, ...envPatch },
    preparation: {
      configDir: home ?? router.systemDefaultHome(),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch,
      provenance: home ? `profile:${accountId}` : 'system'
    }
  }
}
