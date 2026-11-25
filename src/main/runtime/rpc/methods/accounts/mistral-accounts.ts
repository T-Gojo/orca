import { defineMethod } from '../../core'
import { MistralAccountMutationParams } from '../../../../../shared/rpc-contract/mistral-account-params'
import { getMistralAccountService } from '../../../../mistral/mistral-account-host'

export const MISTRAL_ACCOUNT_METHODS = [
  defineMethod({
    name: 'accounts.mistralList',
    permission: 'workspace',
    params: null,
    handler: async () => getMistralAccountService().listAccounts()
  }),
  defineMethod({
    name: 'accounts.mistralAddCurrent',
    permission: 'accounts-admin',
    params: null,
    handler: async () => getMistralAccountService().addCurrentAccount()
  }),
  defineMethod({
    name: 'accounts.mistralRemove',
    permission: 'accounts-admin',
    params: MistralAccountMutationParams,
    handler: async ({ accountId }) => getMistralAccountService().removeAccount(accountId)
  })
] as const
