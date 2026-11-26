import { z } from 'zod'
import { ACCOUNT_USAGE_WINDOWS } from '../account-usage-windows-types'
import { DELEGATION_AGENTS, DELEGATION_TIERS } from '../delegation/delegation-types'
import { ECOSYSTEM_CONTROL_ACTIONS } from '../ecosystem/ecosystem-types'

/** Fork: params of the cross-agent delegation RPC methods. */
export const DelegationUsageParams = z
  .object({ refresh: z.boolean().optional() })
  .strict()
  .optional()

export const DelegationRouteParams = z
  .object({
    agent: z.enum(DELEGATION_AGENTS).optional(),
    kind: z.string().min(1).max(64).optional(),
    tier: z.enum(DELEGATION_TIERS).optional(),
    /** A Claude coordinator's own account (id or `system`), which is never routed to. */
    selfAccount: z.string().min(1).max(200).optional(),
    refresh: z.boolean().optional()
  })
  .strict()
  .optional()

export const DelegationAdviceParams = z
  .object({
    agent: z.enum(DELEGATION_AGENTS).optional(),
    /** The coordinator's own saved account id, or `system`; omitted means the active login. */
    selfAccount: z.string().min(1).max(200).optional(),
    refresh: z.boolean().optional()
  })
  .strict()
  .optional()

export const DelegationBackgroundTasksParams = z
  .object({
    /** Include settled workers finished within this many minutes (default 60). */
    recentMinutes: z.number().int().min(1).max(1440).optional()
  })
  .strict()
  .optional()

export const DelegationUsageWindowsParams = z
  .object({
    window: z.enum(ACCOUNT_USAGE_WINDOWS).optional()
  })
  .strict()
  .optional()

export const DelegationEcosystemStatusParams = z.object({}).strict().optional()

export const DelegationEcosystemControlParams = z
  .object({
    action: z.enum(ECOSYSTEM_CONTROL_ACTIONS),
    code: z.string().min(1).max(32).optional(),
    token: z.string().max(400).optional(),
    skillName: z.string().min(1).max(160).optional(),
    message: z.string().min(1).max(8000).optional(),
    channel: z.enum(['auto', 'telegram', 'whatsapp']).optional(),
    enabled: z.boolean().optional()
  })
  .strict()

export const DelegationEcosystemAskParams = z
  .object({
    prompt: z.string().min(1).max(32000),
    source: z.string().max(64).optional(),
    externalId: z.string().max(240).optional(),
    senderName: z.string().max(160).optional(),
    agent: z.string().max(64).optional(),
    wait: z.boolean().optional(),
    rikugan: z.boolean().optional()
  })
  .strict()

export const DelegationEcosystemLearnParams = z
  .object({
    mode: z.enum(['learn', 'review', 'skills-search', 'skills-install']),
    topic: z.string().max(2000).optional(),
    markdown: z.string().max(64000).optional(),
    focus: z.string().max(2000).optional(),
    query: z.string().max(400).optional()
  })
  .strict()
