import { lstat, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { credentialFileExists, inCredentialFileOrder } from '../credentials/credential-file-io'
import { getSecretStore } from '../../shared/secure-storage/secret-store'
import { writeCredentialFileAtomic } from '../credentials/integration-credential-file'
import type { MistralAccountSummary } from '../../shared/mistral-account-types'

export type StoredMistralAccount = MistralAccountSummary & { apiKey: string }
export type MistralAccountVault = {
  accounts: StoredMistralAccount[]
}
export type MistralAccountStore = {
  read(): Promise<MistralAccountVault>
  write(vault: MistralAccountVault): Promise<void>
}

const MAX_VAULT_BYTES = 4 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isAccount(value: unknown): value is StoredMistralAccount {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.customer === 'string' &&
    isNullableString(value.planName) &&
    isNullableString(value.organizationId) &&
    typeof value.keyFingerprint === 'string' &&
    value.keyFingerprint.length > 0 &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.apiKey === 'string' &&
    value.apiKey.length > 0
  )
}

function requireProtection(): void {
  const secrets = getSecretStore()
  if (!secrets.isEncryptionAvailable() || secrets.describeProtectionGap() !== null) {
    throw new Error('Protected secret storage is unavailable; Mistral accounts were not changed.')
  }
}

export function createEncryptedMistralAccountStore(path: string): MistralAccountStore {
  return {
    async read() {
      return inCredentialFileOrder(`${path}.mutation`, async () => {
        if (!(await credentialFileExists(path))) {
          return { accounts: [] }
        }
        requireProtection()
        try {
          const info = await lstat(path)
          if (
            !info.isFile() ||
            info.size > MAX_VAULT_BYTES ||
            (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
          ) {
            throw new Error('unsafe vault')
          }
          const value: unknown = JSON.parse(getSecretStore().decryptString(await readFile(path)))
          if (!isRecord(value) || !Array.isArray(value.accounts)) {
            throw new Error('invalid vault')
          }
          if (!value.accounts.every(isAccount)) {
            throw new Error('invalid vault')
          }
          const ids = new Set(value.accounts.map((account) => account.id))
          if (ids.size !== value.accounts.length) {
            throw new Error('invalid vault')
          }
          return { accounts: value.accounts }
        } catch {
          throw new Error(
            'Mistral account snapshots could not be read; the existing vault was preserved.'
          )
        }
      })
    },
    async write(vault) {
      return inCredentialFileOrder(`${path}.mutation`, async () => {
        requireProtection()
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        try {
          const encrypted = getSecretStore().encryptString(JSON.stringify(vault))
          if (encrypted.length > MAX_VAULT_BYTES) {
            throw new Error('vault exceeds readable size')
          }
          await writeCredentialFileAtomic(path, encrypted)
          if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) {
            throw new Error('unsafe permissions')
          }
        } catch {
          throw new Error('Mistral account snapshots could not be saved.')
        }
      })
    }
  }
}
