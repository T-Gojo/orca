import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { getSecretStore } from '../../shared/secret-store'
import { writeCredentialFileAtomic } from '../integration-credential-file'
import type { KiroAccountSummary } from '../../shared/kiro-account-types'
import { decodeKiroCliLogin } from './kiro-cli-login'

export type StoredKiroAccount = KiroAccountSummary & { login: string }
export type KiroAccountVault = {
  accounts: StoredKiroAccount[]
  selectedAccountId: string | null
}
export type KiroAccountStore = {
  read(): KiroAccountVault
  write(vault: KiroAccountVault): void
}

const MAX_VAULT_BYTES = 4 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isAccount(value: unknown): value is StoredKiroAccount {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isNullableString(value.email) &&
    isNullableString(value.userId) &&
    typeof value.authMethod === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.login === 'string'
  )
}

function requireProtection(): void {
  const secrets = getSecretStore()
  if (!secrets.isEncryptionAvailable() || secrets.describeProtectionGap() !== null) {
    throw new Error('Protected secret storage is unavailable; Kiro accounts were not changed.')
  }
}

export function createEncryptedKiroAccountStore(path: string): KiroAccountStore {
  return {
    read() {
      if (!existsSync(path)) {
        return { accounts: [], selectedAccountId: null }
      }
      requireProtection()
      try {
        const stat = lstatSync(path)
        if (
          !stat.isFile() ||
          stat.size > MAX_VAULT_BYTES ||
          (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        ) {
          throw new Error('unsafe vault')
        }
        const value: unknown = JSON.parse(getSecretStore().decryptString(readFileSync(path)))
        if (
          !isRecord(value) ||
          !Array.isArray(value.accounts) ||
          !value.accounts.every(isAccount) ||
          !isNullableString(value.selectedAccountId)
        ) {
          throw new Error('invalid vault')
        }
        const ids = new Set(value.accounts.map((account) => account.id))
        if (
          ids.size !== value.accounts.length ||
          (value.selectedAccountId !== null && !ids.has(value.selectedAccountId))
        ) {
          throw new Error('invalid selection')
        }
        for (const account of value.accounts) {
          decodeKiroCliLogin(account.login)
        }
        return { accounts: value.accounts, selectedAccountId: value.selectedAccountId }
      } catch {
        throw new Error(
          'Kiro account snapshots could not be read; the existing vault was preserved.'
        )
      }
    },
    write(vault) {
      requireProtection()
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try {
        const encrypted = getSecretStore().encryptString(JSON.stringify(vault))
        if (encrypted.length > MAX_VAULT_BYTES) {
          throw new Error('vault exceeds readable size')
        }
        writeCredentialFileAtomic(path, encrypted)
        if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
          throw new Error('unsafe permissions')
        }
      } catch {
        throw new Error('Kiro account snapshots could not be saved.')
      }
    }
  }
}
