import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { probeAntigravityAccountUsage } from './antigravity-account-usage-probe'
import { probeKiroAccountUsage } from './kiro-account-usage-probe'
import type { RateLimitService } from './service/rate-limit-service'

/** Fork: reads each saved Kiro/Antigravity account's usage without switching the CLI's login. */
export function wireSavedAccountUsage(rateLimits: RateLimitService): void {
  rateLimits.setAntigravityAccountsReader(async () => {
    const state = await (await getAntigravityAccountService({ runtime: 'host' })).listAccounts()
    return {
      activeAccountId: state.activeAccountId,
      accounts: state.accounts.map((account) => ({ id: account.id, email: account.email }))
    }
  })
  rateLimits.setAntigravityAccountUsageProbe(async (accountId) => {
    const service = await getAntigravityAccountService({ runtime: 'host' })
    return probeAntigravityAccountUsage(accountId, {
      logins: {
        read: (id) => service.readSavedCredential(id),
        update: (id, previous, next) => service.updateSavedCredential(id, previous, next)
      },
      probeRoot: join(getAppEnvironment().getPath('userData'), 'antigravity-accounts', 'probe')
    })
  })
  rateLimits.setKiroAccountsReader(async () => {
    const state = await getKiroAccountService().listAccounts()
    return {
      activeAccountId: state.activeAccountId,
      accounts: state.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        authProvenance: account.userId
      }))
    }
  })
  rateLimits.setKiroAccountUsageProbe((accountId) => {
    const service = getKiroAccountService()
    return probeKiroAccountUsage(accountId, {
      read: (id) => service.readSavedLogin(id),
      update: (id, previous, next) => service.updateSavedLogin(id, previous, next)
    })
  })
}
