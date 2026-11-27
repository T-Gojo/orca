import { randomUUID } from 'node:crypto'
import type { AntigravityAccountState } from '../../shared/agent-accounts/antigravity/antigravity-account-types'
import { AntigravityAccountService } from './native-account-service'
import { parseAntigravityNativeCredential } from './native-credential-codec'

/**
 * Fork: the account behaviour this fork adds to upstream's service, kept in its own class so the
 * upstream file stays as it is (see FORK.md, sections 2 and 4).
 */
export class ForkAntigravityAccountService extends AntigravityAccountService {
  /** Saves logins Bridge Hub kept for agy; accounts already saved (refresh token or email) stay. */
  importLogins(
    logins: readonly { email: string | null; contents: string }[]
  ): Promise<{ state: AntigravityAccountState; imported: number; skipped: number }> {
    return this.serialize(async () => {
      const { current } = await this.reconcile()
      const parseCredential = this.backend.parse ?? parseAntigravityNativeCredential
      const latest = await this.store.read()
      let imported = 0
      for (const login of logins) {
        const credential = parseCredential(login.contents)
        const email = login.email?.toLowerCase() ?? null
        if (
          latest.accounts.some(
            (entry) =>
              this.matches(entry, credential) ||
              (email !== null && entry.email?.toLowerCase() === email)
          )
        ) {
          continue
        }
        // A stale access token cannot be identified; the subject is then learned on first use.
        const identity =
          credential.identity ??
          (await this.lookupIdentity(credential.accessToken).catch(() => null))
        const timestamp = this.now()
        latest.accounts.push({
          id: randomUUID(),
          email: identity?.email ?? login.email,
          subject: identity?.subject ?? null,
          authMethod: credential.authMethod,
          credentials: login.contents,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        imported++
      }
      if (imported > 0) {
        await this.store.write(latest)
      }
      return {
        state: this.state({ vault: latest, current }),
        imported,
        skipped: logins.length - imported
      }
    })
  }

  /** A saved account's login, for reading its usage without making it the native login. */
  readSavedCredential(id: string): Promise<string | null> {
    return this.serialize(async () => {
      return (
        (await this.store.read()).accounts.find((account) => account.id === id)?.credentials ?? null
      )
    })
  }

  /** Keeps a saved login current after agy refreshed it outside the native store. */
  updateSavedCredential(id: string, previous: string, next: string): Promise<void> {
    return this.serialize(async () => {
      const vault = await this.store.read()
      const account = vault.accounts.find((entry) => entry.id === id)
      // Why both: a concurrent save or a different Google identity must never be overwritten.
      if (
        !account ||
        account.credentials !== previous ||
        !this.matches(account, parseAntigravityNativeCredential(next))
      ) {
        return
      }
      account.credentials = next
      account.updatedAt = this.now()
      await this.store.write(vault)
    })
  }

  /**
   * Other tools (Bridge Hub rotation, agy /logout) switch agy's single login; a launch follows it
   * instead of refusing. An unsaved login just clears the selection.
   */
  override prepareForLaunch(): Promise<void> {
    return this.serialize(async () => {
      let reconciled: Awaited<ReturnType<ForkAntigravityAccountService['reconcile']>>
      try {
        reconciled = await this.reconcile()
      } catch (error) {
        if (error instanceof Error && error.message.includes('keyring fallback marker')) {
          console.warn('[antigravity] Keyring fallback marker present; letting agy launch:', error)
          return
        }
        throw error
      }
      const { vault, current } = reconciled
      if (!vault.selectedAccountId) {
        return
      }
      if (!current) {
        throw new Error('agy is signed out. Select an Antigravity account in Accounts first.')
      }
      const selected = vault.accounts.find((account) => account.id === vault.selectedAccountId)
      if (selected && this.matches(selected, current)) {
        return
      }
      const latest = await this.store.read()
      latest.selectedAccountId =
        latest.accounts.find((account) => this.matches(account, current))?.id ?? null
      await this.store.write(latest)
    })
  }
}
