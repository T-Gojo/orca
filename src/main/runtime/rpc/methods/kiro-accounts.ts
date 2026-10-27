import { defineMethod } from '../core'
import { KiroAccountMutationParams } from '../../../../shared/rpc-contract/kiro-accounts-params'
import { getKiroAccountService } from '../../../kiro/kiro-account-host'

export const KIRO_ACCOUNT_METHODS = [
  defineMethod({
    name: 'accounts.kiroList',
    permission: 'workspace',
    params: null,
    handler: async () => getKiroAccountService().listAccounts()
  }),
  defineMethod({
    name: 'accounts.kiroAddCurrent',
    permission: 'accounts-admin',
    params: null,
    handler: async () => getKiroAccountService().addCurrentAccount()
  }),
  defineMethod({
    name: 'accounts.kiroBeginSignIn',
    permission: 'accounts-admin',
    params: null,
    handler: async () => getKiroAccountService().beginNewSignIn()
  }),
  defineMethod({
    name: 'accounts.kiroSelect',
    permission: 'accounts-admin',
    params: KiroAccountMutationParams,
    handler: async ({ accountId }) => getKiroAccountService().selectAccount(accountId)
  }),
  defineMethod({
    name: 'accounts.kiroRemove',
    permission: 'accounts-admin',
    params: KiroAccountMutationParams,
    handler: async ({ accountId }) => getKiroAccountService().removeAccount(accountId)
  })
] as const
