import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state: {
  home: string
  userData: string
  selectedAccountId: string | null
  prepareForLaunch: ReturnType<typeof vi.fn<() => Promise<void>>>
} = vi.hoisted(() => ({
  home: '',
  userData: '',
  selectedAccountId: 'acct-selected',
  prepareForLaunch: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))

vi.mock('../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({
    getPath: (name: string) => (name === 'userData' ? state.userData : state.home)
  })
}))

vi.mock('./native-account-store', () => ({
  createEncryptedAntigravityAccountStore: () => ({
    read: async () => ({ accounts: [], selectedAccountId: state.selectedAccountId })
  })
}))

vi.mock('./native-account-host', () => ({
  getAntigravityAccountVaultPath: () => join(state.userData, 'antigravity-accounts', 'vault'),
  getAntigravityAccountService: async () => ({
    prepareForLaunch: state.prepareForLaunch
  })
}))

const { prepareAntigravityAccountForLaunch } = await import('./native-account-launch')

const tempDirs: string[] = []

function setupHostDirs(): { home: string; userData: string } {
  const home = mkdtempSync(join(tmpdir(), 'agy-host-home-'))
  const userData = mkdtempSync(join(tmpdir(), 'agy-userdata-'))
  tempDirs.push(home, userData)
  const vaultPath = join(userData, 'antigravity-accounts', 'vault')
  mkdirSync(dirname(vaultPath), { recursive: true })
  writeFileSync(vaultPath, 'vault-present')
  state.home = home
  state.userData = userData
  return { home, userData }
}

describe('prepareAntigravityAccountForLaunch', () => {
  afterEach(() => {
    state.prepareForLaunch.mockClear()
    state.selectedAccountId = 'acct-selected'
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  })

  it('allows isolated delegation --account overlay launches without touching host selection', async () => {
    const { userData } = setupHostDirs()
    const overlayHome = join(userData, 'delegation-homes', 'antigravity', 'acct-b', 'home')

    await expect(
      prepareAntigravityAccountForLaunch({
        launchAgent: 'antigravity',
        command: 'agy',
        env: {
          HOME: overlayHome,
          ORCA_ACCOUNT_HOME: overlayHome,
          ORCA_DELEGATION_WORKER: '1',
          SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0'
        },
        envIsComplete: true
      })
    ).resolves.toBeUndefined()

    expect(state.prepareForLaunch).not.toHaveBeenCalled()
  })

  it('reconciles default host launches even when login-shell setup strips HOME in envToDelete', async () => {
    const { home } = setupHostDirs()
    const cleanHostEnv: NodeJS.ProcessEnv = { HOME: home, PATH: '/usr/bin:/bin' }
    if (process.env.SSH_CONNECTION) {
      cleanHostEnv.SSH_CONNECTION = process.env.SSH_CONNECTION
    }

    await expect(
      prepareAntigravityAccountForLaunch({
        launchAgent: 'antigravity',
        command: 'agy',
        env: cleanHostEnv,
        envIsComplete: true,
        envToDelete: ['HOME']
      })
    ).resolves.toBeUndefined()

    expect(state.prepareForLaunch).toHaveBeenCalledTimes(1)
  })
})
