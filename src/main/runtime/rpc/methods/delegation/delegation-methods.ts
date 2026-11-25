import { defineMethod } from '../../core'
import {
  DelegationAdviceParams,
  DelegationBackgroundTasksParams,
  DelegationRouteParams,
  DelegationUsageParams
} from '../../../../../shared/rpc-contract/delegation-params'
import {
  delegationPreferencesPath,
  readDelegationPreferences
} from '../../../../delegation/delegation-preferences'
import {
  readDelegationUsage,
  refreshDelegationUsageSoon,
  routeDelegationTask
} from '../../../../delegation/delegation-service'
import { buildDelegationAdvice } from '../../../../delegation/delegation-advice'
import { queryBackgroundTasksSnapshot } from '../../../../delegation/background-tasks-query'

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
        ...(params?.tier ? { tier: params.tier } : {}),
        ...(params?.selfAccount ? { exclude: [`claude:${params.selfAccount}`] } : {}),
        refresh: params?.refresh !== false
      })
  }),
  defineMethod({
    name: 'delegation.advice',
    permission: 'workspace',
    params: DelegationAdviceParams,
    handler: async (params, { runtime }) => {
      const [{ usage }, preferences] = await Promise.all([
        readDelegationUsage(runtime, { refresh: params?.refresh === true }),
        readDelegationPreferences()
      ])
      refreshDelegationUsageSoon(runtime, usage)
      const self = params?.selfAccount
      return buildDelegationAdvice(preferences, usage, {
        agent: params?.agent ?? 'claude',
        ...(self ? { accountId: self === 'system' ? null : self } : {})
      })
    }
  }),
  defineMethod({
    name: 'delegation.preferences',
    permission: 'workspace',
    params: null,
    handler: async () => ({
      path: delegationPreferencesPath(),
      preferences: await readDelegationPreferences()
    })
  }),
  defineMethod({
    name: 'delegation.backgroundTasks',
    permission: 'workspace',
    params: DelegationBackgroundTasksParams,
    handler: async (params, { runtime }) =>
      queryBackgroundTasksSnapshot(
        runtime,
        params?.recentMinutes !== undefined ? { recentMinutes: params.recentMinutes } : undefined
      )
  })
] as const
