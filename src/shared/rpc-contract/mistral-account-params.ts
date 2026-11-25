import { z } from 'zod'

export const MistralAccountMutationParams = z.strictObject({
  accountId: z.string().min(1).max(128)
})
