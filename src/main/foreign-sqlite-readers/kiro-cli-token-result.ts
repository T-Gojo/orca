import { z } from 'zod'

export type KiroCliToken = {
  accessToken: string
  expiresAt: string | null
  region: string | null
}

export type KiroCliTokenReadResult =
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'ok'; token: KiroCliToken }

export function kiroCliTokenReadFailure(): KiroCliTokenReadResult {
  return { status: 'error', error: 'Unable to read the Kiro CLI login' }
}

const nullableString = z.string().nullable()
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('missing') }),
  z.object({ status: z.literal('error'), error: z.string() }),
  z.object({
    status: z.literal('ok'),
    token: z.object({
      accessToken: z.string(),
      expiresAt: nullableString,
      region: nullableString
    })
  })
])

// Validate structured-clone replies at the worker boundary.
export function parseKiroCliTokenReadResult(value: unknown): KiroCliTokenReadResult | null {
  const parsed = resultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
