import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../shared/claude-profile-routing'
import { CLAUDE_TERMINAL_ACCOUNT_PIN_ENV } from '../../shared/agent-terminal-account-pin'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { prepareClaudeTerminalAccountPin } from './claude-terminal-account-pin'

let dataRoot: string

const GLOBAL_HOME = '/data/claude-profiles/global/home'
const PINNED_HOME = '/data/claude-profiles/pinned/home'
let routerInstalled = true

vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => dataRoot })
}))
// The globally selected account routes every terminal unless one is pinned.
vi.mock('./claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () =>
    routerInstalled
      ? {
          coveredBySystemDefault: () => false,
          prepareAccount: async () => PINNED_HOME,
          systemDefaultHome: () => '/home/me/.claude'
        }
      : undefined,
  withClaudeProfileTerminalEnv: (env: Record<string, string> | undefined) => ({
    ...env,
    ORCA_CLAUDE_PROFILE_POINTER: '/data/claude-profiles/selected-host',
    CLAUDE_CONFIG_DIR: GLOBAL_HOME,
    ORCA_CLAUDE_INJECTED_CONFIG_DIR: GLOBAL_HOME
  })
}))
const HOST = { runtime: 'host' as const, wslDistro: null }

function account(id: string): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.com`,
    managedAuthPath: `/data/claude-profiles/${id}/home`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

const settings = { claudeManagedAccounts: [account('global'), account('pinned')] }

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'orca-claude-pin-'))
  routerInstalled = true
})

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

describe('prepareClaudeTerminalAccountPin', () => {
  it('routes a pinned terminal, and any claude typed in it later, to its own account', async () => {
    const pin = await prepareClaudeTerminalAccountPin(
      { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: 'pinned', TERM: 'xterm' },
      HOST,
      settings
    )

    expect(pin.env?.CLAUDE_CONFIG_DIR).toBe(PINNED_HOME)
    expect(pin.env?.[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(PINNED_HOME)
    expect(pin.env?.[CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]).toBeUndefined()
    expect(pin.env?.TERM).toBe('xterm')
    const pointer = pin.env?.[CLAUDE_PROFILE_POINTER_ENV] ?? ''
    expect(pointer).not.toBe('/data/claude-profiles/selected-host')
    expect(readFileSync(pointer, 'utf8')).toBe(PINNED_HOME)
    expect(pin.preparation?.provenance).toBe('profile:pinned')
  })

  it('pins System default by dropping the global account and pointing at no account', async () => {
    const pin = await prepareClaudeTerminalAccountPin(
      { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: 'system-default' },
      HOST,
      settings
    )

    expect(pin.env?.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(pin.env?.[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBeUndefined()
    expect(readFileSync(pin.env?.[CLAUDE_PROFILE_POINTER_ENV] ?? '', 'utf8')).toBe('')
    expect(pin.preparation?.provenance).toBe('system')
  })

  it('refuses an account id that is not saved, before it can name a folder', async () => {
    await expect(
      prepareClaudeTerminalAccountPin(
        { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: '../escape' },
        HOST,
        settings
      )
    ).rejects.toThrow('no longer saved')
  })

  it('follows the selection on WSL and strips the hint', async () => {
    const pin = await prepareClaudeTerminalAccountPin(
      { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: 'pinned' },
      { runtime: 'wsl', wslDistro: 'Ubuntu' },
      settings
    )

    expect(pin).toEqual({ env: {}, preparation: null })
  })
})
