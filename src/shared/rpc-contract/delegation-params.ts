import { z } from 'zod'
import { DELEGATION_AGENTS, DELEGATION_TIERS } from '../delegation/delegation-types'

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
