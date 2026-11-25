import { z } from 'zod'

export const KiroAccountMutationParams = z.strictObject({
  accountId: z.string().min(1).max(128)
})
