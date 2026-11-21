import { defineMethod } from '../../core'
import {
  DelegationRouteParams,
  DelegationUsageParams
} from '../../../../../shared/rpc-contract/delegation-params'
import {
  delegationPreferencesPath,
  readDelegationPreferences
} from '../../../../delegation/delegation-preferences'
import { readDelegationUsage, routeDelegationTask } from '../../../../delegation/delegation-service'

/** Fork: usage-aware routing of work to other agents and their saved accounts. */
export const DELEGATION_METHODS = [
  defineMethod({
    name: 'delegation.usage',
    permission: 'workspace',
    params: DelegationUsageParams,
    handler: async (params, { runtime }) =>
      readDelegationUsage(runtime, { refresh: params?.refresh === true })
  }),
  defineMethod({
    name: 'delegation.route',
    permission: 'workspace',
    params: DelegationRouteParams,
    handler: async (params, { runtime }) =>
      routeDelegationTask(runtime, {
        ...(params?.agent ? { agent: params.agent } : {}),
        ...(params?.kind ? { kind: params.kind } : {}),
        refresh: params?.refresh !== false
      })
  }),
  defineMethod({
    name: 'delegation.preferences',
    permission: 'workspace',
    params: null,
    handler: async () => ({
      path: delegationPreferencesPath(),
      preferences: await readDelegationPreferences()
    })
  })
] as const
