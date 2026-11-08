import { describe, expect, it } from 'vitest'
import { KiroAccountService, type KiroLoginBackend } from './kiro-account-service'
import type { KiroAccountStore, KiroAccountVault } from './kiro-account-store'
import { encodeKiroCliLogin } from './kiro-cli-login'

const FUTURE = '2999-01-01T00:00:00Z'

function login(user: string, generation = 1): string {
  return encodeKiroCliLogin({
    auth: {
      'kirocli:odic:token': JSON.stringify({
        access_token: `${user}-access-${generation}`,
        refresh_token: `${user}-refresh-${generation}`,
        expires_at: FUTURE,
        region: 'us-east-1'
      })
    },
    state: {}
  })
}

function setup(initial: string | null) {
  let vault: KiroAccountVault = { accounts: [], selectedAccountId: null }
  const store: KiroAccountStore = {
    read: () => structuredClone(vault),
    write: (next) => {
      vault = structuredClone(next)
    }
  }
  const native = { contents: initial }
  const backend: KiroLoginBackend = {
    read: async () => native.contents,
    write: async (contents, expected) => {
      if (native.contents !== expected) {
        throw new Error('conflict')
      }
      native.contents = contents
    }
  }
  const service = new KiroAccountService(store, backend, async (token) => {
    const user = token.accessToken.split('-')[0]
    return { userId: `id-${user}`, email: `${user}@example.com` }
  })
  return { service, native, vault: () => vault }
}

describe('KiroAccountService', () => {
  it('saves logins, switches kiro-cli between them and keeps refreshed tokens', async () => {
    const { service, native, vault } = setup(login('ana'))
    await service.addCurrentAccount()
    const signedOut = await service.beginNewSignIn()
    expect(native.contents).toBeNull()
    expect(signedOut.currentAccount).toBeNull()

    native.contents = login('bo')
    const both = await service.addCurrentAccount()
    expect(both.accounts.map((account) => account.email)).toEqual([
      'ana@example.com',
      'bo@example.com'
    ])
    const [ana, bo] = both.accounts

    const switched = await service.selectAccount(ana.id)
    expect(native.contents).toBe(login('ana'))
    expect(switched.activeAccountId).toBe(ana.id)

    // kiro-cli refreshed Ana's token: still Ana, and her snapshot follows the new login.
    native.contents = login('ana', 2)
    const refreshed = await service.listAccounts()
    expect(refreshed.activeAccountId).toBe(ana.id)
    expect(vault().accounts.find((account) => account.id === ana.id)?.login).toBe(login('ana', 2))

    await expect(service.removeAccount(ana.id)).rejects.toThrow(/another account/)
    const remaining = await service.removeAccount(bo.id)
    expect(remaining.accounts.map((account) => account.id)).toEqual([ana.id])
  })

  it('does not save a login it cannot identify', async () => {
    const expired = encodeKiroCliLogin({
      auth: {
        'kirocli:odic:token': JSON.stringify({
          access_token: 'old-access',
          expires_at: '2000-01-01T00:00:00Z'
        })
      },
      state: {}
    })
    const { service } = setup(expired)

    await expect(service.addCurrentAccount()).rejects.toThrow(/could not confirm/)
    await expect(service.beginNewSignIn()).rejects.toThrow(/could not confirm/)
  })

  it('keeps an unsaved login when switching away from it', async () => {
    const { service, native } = setup(login('ana'))
    const [ana] = (await service.addCurrentAccount()).accounts
    native.contents = login('cy')

    const switched = await service.selectAccount(ana.id)

    expect(native.contents).toBe(login('ana'))
    expect(switched.accounts.map((account) => account.email)).toEqual([
      'ana@example.com',
      'cy@example.com'
    ])
  })
})
