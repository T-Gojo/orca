import { z } from 'zod'
import { getMainHttpClient } from '../network/http-client'

const WHOAMI_TIMEOUT_MS = 15_000
const WHOAMI_URL = 'https://console.mistral.ai/api/vibe/whoami'

/** Mistral's own identity read (`GET /api/vibe/whoami`); extra response fields are ignored. */
const MistralWhoamiSchema = z.object({
  plan_type: z.string().nullish(),
  plan_name: z.string().nullish(),
  organization_kind: z.string().nullish(),
  customer_id: z.string().nullish(),
  api_base: z.string().nullish(),
  vibe_base: z.string().nullish(),
  has_paid_vibe_entitlement: z.boolean().nullish(),
  can_access_private_resources: z.boolean().nullish()
})

export type MistralWhoami = z.infer<typeof MistralWhoamiSchema>

/** Confirms which account an API key belongs to. Null on 401, any other failure, or a bad payload. */
export async function fetchMistralWhoami(apiKey: string): Promise<MistralWhoami | null> {
  try {
    const res = await getMainHttpClient().fetch(WHOAMI_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(WHOAMI_TIMEOUT_MS)
    })
    if (!res.ok) {
      return null
    }
    const parsed = MistralWhoamiSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
