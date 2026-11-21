import { z } from 'zod'
import { DELEGATION_AGENTS } from '../delegation/delegation-types'

/** Fork: params of the cross-agent delegation RPC methods. */
export const DelegationUsageParams = z
  .object({ refresh: z.boolean().optional() })
  .strict()
  .optional()

export const DelegationRouteParams = z
  .object({
    agent: z.enum(DELEGATION_AGENTS).optional(),
    kind: z.string().min(1).max(64).optional(),
    refresh: z.boolean().optional()
  })
  .strict()
  .optional()
