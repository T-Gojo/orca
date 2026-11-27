import { defineMethod } from '../../core'
import {
  DelegationAdviceParams,
  DelegationBackgroundTasksParams,
  DelegationEcosystemAskParams,
  DelegationEcosystemControlParams,
  DelegationEcosystemLearnParams,
  DelegationEcosystemStatusParams,
  DelegationRouteParams,
  DelegationUsageParams,
  DelegationUsageWindowsParams
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
import { readAccountUsageWindowsSnapshot } from '../../../../usage/account-usage-windows-bridge'
import { controlEcosystem, readEcosystemStatus } from '../../../../ecosystem/ecosystem-service'
import { askEcosystem, runEcosystemHermesAction } from '../../../../ecosystem/ecosystem-actions'

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
      queryBackgroundTasksSnapshot(runtime, {
        ...(params?.recentMinutes !== undefined ? { recentMinutes: params.recentMinutes } : {}),
        ...(params?.paneKey ? { paneKey: params.paneKey } : {}),
        ...(params?.worktreeId ? { worktreeId: params.worktreeId } : {})
      })
  }),
  defineMethod({
    name: 'delegation.usageWindows',
    permission: 'workspace',
    params: DelegationUsageWindowsParams,
    handler: async (params) => readAccountUsageWindowsSnapshot(params?.window ?? '5h')
  }),
  defineMethod({
    name: 'delegation.ecosystemStatus',
    permission: 'workspace',
    params: DelegationEcosystemStatusParams,
    handler: async (_params, { runtime }) => readEcosystemStatus(runtime)
  }),
  defineMethod({
    name: 'delegation.ecosystemControl',
    permission: 'workspace',
    params: DelegationEcosystemControlParams,
    handler: async (params, { runtime }) => controlEcosystem(runtime, params)
  }),
  defineMethod({
    name: 'delegation.ecosystemAsk',
    permission: 'workspace',
    params: DelegationEcosystemAskParams,
    handler: async (params, { runtime }) => askEcosystem(runtime, params)
  }),
  defineMethod({
    name: 'delegation.ecosystemLearn',
    permission: 'workspace',
    params: DelegationEcosystemLearnParams,
    handler: async (params, { runtime }) => runEcosystemHermesAction(runtime, params)
  })
] as const
