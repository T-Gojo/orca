import { createHash, randomUUID } from 'node:crypto'
import type { MistralAccountState } from '../../shared/mistral-account-types'
import type { CurrentMistralApiKey } from './mistral-credential-source'
import type {
  MistralAccountStore,
  MistralAccountVault,
  StoredMistralAccount
} from './mistral-account-store'
import type { MistralWhoami } from './mistral-whoami'

const IDENTITY_CACHE_LIMIT = 16
const WHOAMI_REFRESH_MS = 60 * 60 * 1000
const UNKNOWN_ACCOUNT_LABEL = '<account-label>'

export function mistralKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 32)
}

function customerLabelOf(customerId: string | null | undefined): string {
  return customerId ? customerId.slice(0, 8) : UNKNOWN_ACCOUNT_LABEL
}

type CurrentMistralKey = {
  apiKey: string
  source: CurrentMistralApiKey['source']
  fingerprint: string
  identity: MistralWhoami | null
}

function identityOfAccount(account: StoredMistralAccount): MistralWhoami | null {
  return account.organizationId
    ? { customer_id: account.organizationId, plan_name: account.planName }
    : null
}

export class MistralAccountService {
  private mutation: Promise<unknown> = Promise.resolve()
  // Keyed by key fingerprint: only a confirmed whoami is cached, so a passing network
  // failure must not hide the account until restart.
  private readonly identities = new Map<string, MistralWhoami>()
  // Per saved account: when its stored identity was last refreshed.
  private readonly checkedAt = new Map<string, number>()

  constructor(
    private readonly store: MistralAccountStore,
    private readonly readCurrentKey: () => Promise<CurrentMistralApiKey | null>,
    private readonly lookupWhoami: (apiKey: string) => Promise<MistralWhoami | null>,
    private readonly now: () => number = Date.now
  ) {}

  listAccounts(): Promise<MistralAccountState> {
    return this.serialize(async () => this.state(await this.reconcile()))
  }

  addCurrentAccount(): Promise<MistralAccountState> {
    return this.serialize(async () => {
      const vault = await this.store.read()
      const read = await this.readCurrentKey()
      if (!read) {
        throw new Error(
          'Sign in to Mistral Vibe with `vibe --setup` or set MISTRAL_API_KEY first, then save the account.'
        )
      }
      const fingerprint = mistralKeyFingerprint(read.apiKey)
      if (vault.accounts.some((account) => account.keyFingerprint === fingerprint)) {
        throw new Error('This Mistral account is already saved.')
      }
      const identity = await this.identify(fingerprint, read.apiKey)
      if (!identity) {
        // Why refuse: a key whose account cannot be named could not be told apart later.
        throw new Error(
          'Mistral could not confirm which account the API key belongs to. Run Mistral Vibe once first so the account can be identified, then try again.'
        )
      }
      const timestamp = this.now()
      vault.accounts.push({
        id: randomUUID(),
        customer: customerLabelOf(identity.customer_id),
        planName: identity.plan_name ?? null,
        organizationId: identity.customer_id ?? null,
        keyFingerprint: fingerprint,
        apiKey: read.apiKey,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      await this.store.write(vault)
      return this.state({
        vault,
        current: { ...read, fingerprint, identity }
      })
    })
  }

  removeAccount(id: string): Promise<MistralAccountState> {
    return this.serialize(async () => {
      const { vault, current } = await this.reconcile()
      if (!vault.accounts.some((entry) => entry.id === id)) {
        throw new Error('Mistral account was not found.')
      }
      // Why no active-account guard: the current key lives outside the vault (env, `.env`
      // or keychain), so removing its snapshot stops Orca injecting it, nothing breaks.
      vault.accounts = vault.accounts.filter((entry) => entry.id !== id)
      this.checkedAt.delete(id)
      await this.store.write(vault)
      return this.state({ vault, current })
    })
  }

  /** A saved account's API key, for per-terminal env injection. Main-only; never an RPC. */
  readAccountApiKey(id: string): Promise<string | null> {
    return this.serialize(async () => {
      return (await this.store.read()).accounts.find((account) => account.id === id)?.apiKey ?? null
    })
  }

  private async reconcile(): Promise<{
    vault: MistralAccountVault
    current: CurrentMistralKey | null
  }> {
    const read = await this.readCurrentKey()
    if (!read) {
      return { vault: await this.store.read(), current: null }
    }
    const fingerprint = mistralKeyFingerprint(read.apiKey)
    const vault = await this.store.read()
    const account = vault.accounts.find((entry) => entry.keyFingerprint === fingerprint)
    // Re-read after the identity lookups so a slow whoami never restores an older vault.
    let current: CurrentMistralKey = { ...read, fingerprint, identity: null }
    if (account) {
      await this.refreshStoredIdentity(vault, account)
      current = { ...current, identity: identityOfAccount(account) }
    } else {
      current = { ...current, identity: await this.identify(fingerprint, read.apiKey) }
    }
    return { vault: await this.store.read(), current }
  }

  /** Keeps a matched account's plan and customer fields as current as Mistral's own read. */
  private async refreshStoredIdentity(
    vault: MistralAccountVault,
    account: StoredMistralAccount
  ): Promise<void> {
    const last = this.checkedAt.get(account.id) ?? account.updatedAt
    if (this.now() - last < WHOAMI_REFRESH_MS) {
      return
    }
    // Why record before the lookup: a failing read must not run on every poll.
    this.checkedAt.set(account.id, this.now())
    const identity = await this.lookupWhoami(account.apiKey).catch(() => null)
    if (!identity?.customer_id) {
      return
    }
    account.customer = customerLabelOf(identity.customer_id)
    account.planName = identity.plan_name ?? null
    account.organizationId = identity.customer_id
    account.updatedAt = this.now()
    await this.store.write(vault)
  }

  private async identify(fingerprint: string, apiKey: string): Promise<MistralWhoami | null> {
    const cached = this.identities.get(fingerprint)
    if (cached) {
      return cached
    }
    const identity = await this.lookupWhoami(apiKey).catch(() => null)
    if (this.identities.size >= IDENTITY_CACHE_LIMIT) {
      this.identities.clear()
    }
    // Why only a named identity counts: without a customer id the account cannot be told apart.
    if (identity?.customer_id) {
      this.identities.set(fingerprint, identity)
      return identity
    }
    return null
  }

  private state({
    vault,
    current
  }: {
    vault: MistralAccountVault
    current: CurrentMistralKey | null
  }): MistralAccountState {
    return {
      accounts: vault.accounts.map(({ apiKey: _apiKey, ...account }) => account),
      currentAccount: current
        ? {
            customer: customerLabelOf(current.identity?.customer_id),
            planName: current.identity?.plan_name ?? null,
            organizationId: current.identity?.customer_id ?? null,
            keyFingerprint: current.fingerprint,
            identityKnown: current.identity !== null
          }
        : null
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation)
    this.mutation = next.catch(() => undefined)
    return next
  }
}
