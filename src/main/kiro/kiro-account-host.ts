import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  readKiroCliLogin,
  writeKiroCliLogin
} from '../foreign-sqlite-readers/foreign-sqlite-reader-spawn'
import { getKiroCliDbPath } from '../rate-limits/kiro-auth'
import { requestKiroUsageLimits } from '../rate-limits/kiro-usage-fetcher'
import { createEncryptedKiroAccountStore } from './kiro-account-store'
import { readKiroCliWhoamiEmail } from './kiro-cli-whoami'
import { KiroAccountService, type KiroLoginBackend } from './kiro-account-service'

let service: KiroAccountService | null = null

function createKiroCliLoginBackend(dbPath: string): KiroLoginBackend {
  return {
    async read() {
      const result = await readKiroCliLogin(dbPath)
      if (result.status === 'error') {
        throw new Error(result.error)
      }
      return result.status === 'ok' ? result.contents : null
    },
    async write(contents, expected) {
      const result = await writeKiroCliLogin(dbPath, contents, expected)
      if (result.status === 'conflict') {
        throw new Error('kiro-cli changed its sign-in while switching; refresh before retrying.')
      }
      if (result.status === 'error') {
        throw new Error(result.error)
      }
    }
  }
}

export function getKiroAccountService(): KiroAccountService {
  service ??= new KiroAccountService(
    createEncryptedKiroAccountStore(
      join(getAppEnvironment().getPath('userData'), 'kiro-accounts', 'vault')
    ),
    createKiroCliLoginBackend(getKiroCliDbPath()),
    async (token) => {
      const { user } = await requestKiroUsageLimits({
        accessToken: token.accessToken,
        expiresAtMs: token.expiresAtMs,
        region: token.region,
        source: 'cli'
      })
      // Only kiro-cli's own login is ever identified, so whoami describes the same account.
      return user && { userId: user.userId, email: user.email ?? (await readKiroCliWhoamiEmail()) }
    }
  )
  return service
}
