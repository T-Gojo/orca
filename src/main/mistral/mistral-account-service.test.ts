import { describe, expect, it, vi } from 'vitest'
import { MistralAccountService, mistralKeyFingerprint } from './mistral-account-service'
import type { MistralAccountStore, MistralAccountVault } from './mistral-account-store'
import type { CurrentMistralApiKey } from './mistral-credential-source'
import type { MistralWhoami } from './mistral-whoami'

// Clearly fake fixture values; none of these are real credentials.
const FIXTURE_KEY_A = 'mst_local_fixture_key_1'
const FIXTURE_CUSTOMER_A = 'fixture-customer-00001'

function fixtureWhoami(customerId: string): MistralWhoami {
  return { plan_type: 'chat', plan_name: 'INDIVIDUAL', customer_id: customerId }
}

function harness(
  read: () => Promise<CurrentMistralApiKey | null>,
  whoami: (apiKey: string) => Promise<MistralWhoami | null> = async () =>
    fixtureWhoami(FIXTURE_CUSTOMER_A)
) {
  let vault: MistralAccountVault = { accounts: [] }
  const store: MistralAccountStore = {
    read: vi.fn(async () => structuredClone(vault)),
    write: vi.fn(async (next) => {
      vault = structuredClone(next)
    })
  }
  return {
    store,
    service: new MistralAccountService(store, read, whoami, () => 1_000),
    getVault: () => structuredClone(vault)
  }
}

function keyOf(key: string): () => Promise<CurrentMistralApiKey> {
  return async () => ({ apiKey: key, source: 'dotenv' })
}

describe('MistralAccountService', () => {
  it('saves the current key and lists it with a matching currentAccount', async () => {
    const h = harness(keyOf(FIXTURE_KEY_A))
    const saved = await h.service.addCurrentAccount()
    expect(saved.accounts).toHaveLength(1)
    const account = saved.accounts[0]
    expect(account).toMatchObject({
      customer: FIXTURE_CUSTOMER_A.slice(0, 8),
      organizationId: FIXTURE_CUSTOMER_A,
      keyFingerprint: mistralKeyFingerprint(FIXTURE_KEY_A)
    })
    // The raw key never leaves the service state.
    expect(JSON.stringify(saved)).not.toContain(FIXTURE_KEY_A)

    const listed = await h.service.listAccounts()
    expect(listed.accounts.map((entry) => entry.id)).toEqual([account.id])
    expect(listed.currentAccount).toMatchObject({
      keyFingerprint: account.keyFingerprint,
      organizationId: FIXTURE_CUSTOMER_A,
      identityKnown: true
    })
  })

  it('refuses to save the same key twice (dedupe by fingerprint)', async () => {
    const h = harness(keyOf(FIXTURE_KEY_A))
    await h.service.addCurrentAccount()
    await expect(h.service.addCurrentAccount()).rejects.toThrow('already saved')
    expect(h.getVault().accounts).toHaveLength(1)
    expect(h.store.write).toHaveBeenCalledTimes(1)
  })

  it('removes a saved account by id', async () => {
    const h = harness(keyOf(FIXTURE_KEY_A))
    const { accounts } = await h.service.addCurrentAccount()
    const removed = await h.service.removeAccount(accounts[0].id)
    expect(removed.accounts).toHaveLength(0)
    await expect(h.service.removeAccount(accounts[0].id)).rejects.toThrow('was not found')
  })

  it('refuses to save when no Mistral key is available', async () => {
    const h = harness(async () => null)
    await expect(h.service.addCurrentAccount()).rejects.toThrow('vibe --setup')
    expect(h.getVault().accounts).toHaveLength(0)
  })
})
