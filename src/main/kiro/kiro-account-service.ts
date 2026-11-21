import { randomUUID } from 'node:crypto'
import type { KiroAccountState } from '../../shared/kiro-account-types'
import { decodeKiroCliLogin, readKiroCliLoginToken, type KiroCliLoginToken } from './kiro-cli-login'
import type { KiroAccountStore, KiroAccountVault, StoredKiroAccount } from './kiro-account-store'

export type KiroLoginBackend = {
  /** kiro-cli's current login, or null when it is signed out. */
  read(): Promise<string | null>
  /** Replaces the login (null signs kiro-cli out) only while kiro-cli still holds `expected`. */
  write(contents: string | null, expected: string | null): Promise<void>
}

export type KiroLoginIdentity = { userId: string; email: string | null }
export type KiroIdentityLookup = (token: KiroCliLoginToken) => Promise<KiroLoginIdentity | null>

type CurrentLogin = {
  contents: string
  authMethod: string
  identity: KiroLoginIdentity | null
}

const TOKEN_SKEW_MS = 60_000
const IDENTITY_CACHE_LIMIT = 16

function refreshTokenOf(contents: string): string | null {
  return readKiroCliLoginToken(decodeKiroCliLogin(contents))?.refreshToken ?? null
}

export class KiroAccountService {
  private mutation: Promise<unknown> = Promise.resolve()
  // Keyed by access token: one usage read names the account for as long as that token lives.
  private readonly identities = new Map<string, KiroLoginIdentity | null>()

  constructor(
    private readonly store: KiroAccountStore,
    private readonly backend: KiroLoginBackend,
    private readonly lookupIdentity: KiroIdentityLookup,
    private readonly now: () => number = Date.now
  ) {}

  listAccounts(): Promise<KiroAccountState> {
    return this.serialize(async () => this.state(await this.reconcile()))
  }

  addCurrentAccount(): Promise<KiroAccountState> {
    return this.serialize(async () => {
      const { vault, current } = await this.reconcile()
      if (!current) {
        throw new Error('Sign in with `kiro-cli login` on this computer, then save the account.')
      }
      if (this.match(vault, current)) {
        return this.state({ vault, current })
      }
      this.save(vault, current)
      return this.state({ vault, current })
    })
  }

  /**
   * Saves the current login, then signs kiro-cli out locally so `kiro-cli login` can add another
   * account. Why not `kiro-cli logout`: it may end the saved login's session on Kiro's side too.
   */
  beginNewSignIn(): Promise<KiroAccountState> {
    return this.serialize(async () => {
      const { vault, current } = await this.reconcile()
      if (current) {
        if (!this.match(vault, current)) {
          this.save(vault, current)
        }
        await this.backend.write(null, current.contents)
      }
      return this.state({ vault: this.store.read(), current: null })
    })
  }

  selectAccount(id: string): Promise<KiroAccountState> {
    return this.serialize(async () => {
      const { vault, current } = await this.reconcile()
      const selected = vault.accounts.find((account) => account.id === id)
      if (!selected) {
        throw new Error('Kiro account was not found.')
      }
      const active = current ? this.match(vault, current) : undefined
      if (!current || active?.id !== id) {
        // Why: the login being replaced exists nowhere else, so it is kept before switching away.
        if (current && !active) {
          this.save(vault, current)
        }
        await this.backend.write(selected.login, current?.contents ?? null)
      }
      const readback = await this.backend.read()
      const latest = this.store.read()
      const account = latest.accounts.find((entry) => entry.id === id)
      if (
        !account ||
        readback === null ||
        (readback !== selected.login && readback !== account.login)
      ) {
        throw new Error('Kiro account switching could not be verified; refresh before retrying.')
      }
      latest.selectedAccountId = id
      this.store.write(latest)
      return this.state({
        vault: latest,
        current: {
          contents: readback,
          authMethod: account.authMethod,
          identity: identityOf(account)
        }
      })
    })
  }

  removeAccount(id: string): Promise<KiroAccountState> {
    return this.serialize(async () => {
      const { vault, current } = await this.reconcile()
      if (!vault.accounts.some((entry) => entry.id === id)) {
        throw new Error('Kiro account was not found.')
      }
      if (current && this.match(vault, current)?.id === id) {
        throw new Error('Switch kiro-cli to another account before removing this one.')
      }
      vault.accounts = vault.accounts.filter((entry) => entry.id !== id)
      if (vault.selectedAccountId === id) {
        vault.selectedAccountId = null
      }
      this.store.write(vault)
      return this.state({ vault, current })
    })
  }

  /** A saved account's login, for reading its usage without switching kiro-cli to it. */
  readSavedLogin(id: string): Promise<string | null> {
    return this.serialize(async () => {
      return this.store.read().accounts.find((account) => account.id === id)?.login ?? null
    })
  }

  /** Keeps a saved login current after Orca refreshed its token for a usage read. */
  updateSavedLogin(id: string, previous: string, next: string): Promise<void> {
    return this.serialize(async () => {
      const vault = this.store.read()
      const account = vault.accounts.find((entry) => entry.id === id)
      // Why: a concurrent save or a login kiro-cli now holds must never be overwritten.
      if (!account || account.login !== previous || (await this.backend.read()) === previous) {
        return
      }
      decodeKiroCliLogin(next)
      account.login = next
      account.updatedAt = this.now()
      this.store.write(vault)
    })
  }

  private async reconcile(): Promise<{ vault: KiroAccountVault; current: CurrentLogin | null }> {
    const contents = await this.backend.read()
    if (contents === null) {
      return { vault: this.store.read(), current: null }
    }
    const token = readKiroCliLoginToken(decodeKiroCliLogin(contents))
    let current: CurrentLogin = {
      contents,
      authMethod: token?.authMethod ?? 'odic',
      identity: null
    }
    if (!this.match(this.store.read(), current) && token) {
      current = { ...current, identity: await this.identify(token) }
    }
    // Re-read after the identity lookup so a slow read never restores an older vault.
    const vault = this.store.read()
    const account = this.match(vault, current)
    if (account) {
      current = { ...current, identity: current.identity ?? identityOf(account) }
      if (account.login !== contents) {
        // kiro-cli refreshed this account's token; keep the snapshot as current as its login.
        account.login = contents
        account.email = current.identity?.email ?? account.email
        account.updatedAt = this.now()
        this.store.write(vault)
      }
    }
    return { vault, current }
  }

  private save(vault: KiroAccountVault, current: CurrentLogin): void {
    if (!current.identity) {
      throw new Error(
        'Kiro could not confirm which account is signed in. Run kiro-cli once so it renews its sign-in, then try again.'
      )
    }
    const timestamp = this.now()
    vault.accounts.push({
      id: randomUUID(),
      email: current.identity.email,
      userId: current.identity.userId,
      authMethod: current.authMethod,
      login: current.contents,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    this.store.write(vault)
  }

  private match(vault: KiroAccountVault, current: CurrentLogin): StoredKiroAccount | undefined {
    const exact = vault.accounts.find((account) => account.login === current.contents)
    if (exact) {
      return exact
    }
    const userId = current.identity?.userId
    if (userId) {
      return vault.accounts.find((account) => account.userId === userId)
    }
    // A refresh that kept its refresh token is still the same grant.
    const refreshToken = refreshTokenOf(current.contents)
    return refreshToken
      ? vault.accounts.find((account) => refreshTokenOf(account.login) === refreshToken)
      : undefined
  }

  private async identify(token: KiroCliLoginToken): Promise<KiroLoginIdentity | null> {
    if (token.expiresAtMs !== null && token.expiresAtMs - this.now() <= TOKEN_SKEW_MS) {
      return null
    }
    if (this.identities.has(token.accessToken)) {
      return this.identities.get(token.accessToken) ?? null
    }
    const identity = await this.lookupIdentity(token).catch(() => null)
    if (this.identities.size >= IDENTITY_CACHE_LIMIT) {
      this.identities.clear()
    }
    // Why only successes: a passing network failure must not hide the account until restart.
    if (identity) {
      this.identities.set(token.accessToken, identity)
    }
    return identity
  }

  private state({
    vault,
    current
  }: {
    vault: KiroAccountVault
    current: CurrentLogin | null
  }): KiroAccountState {
    const active = current ? this.match(vault, current) : undefined
    const userId = current?.identity?.userId ?? active?.userId ?? null
    return {
      accounts: vault.accounts.map(({ login: _login, ...account }) => account),
      activeAccountId: active?.id ?? null,
      selectedAccountId: vault.selectedAccountId,
      currentAccount: current
        ? {
            email: current.identity?.email ?? active?.email ?? null,
            userId,
            authMethod: current.authMethod,
            identityKnown: userId !== null
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

function identityOf(account: StoredKiroAccount): KiroLoginIdentity | null {
  return account.userId ? { userId: account.userId, email: account.email } : null
}
