import { z } from 'zod'

export type KiroCliLoginReadResult =
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'ok'; contents: string }

export type KiroCliLoginWriteResult =
  | { status: 'ok' }
  | { status: 'conflict' }
  | { status: 'error'; error: string }

export function kiroCliLoginReadFailure(): KiroCliLoginReadResult {
  return { status: 'error', error: 'Unable to read the Kiro CLI login' }
}

export function kiroCliLoginWriteFailure(): KiroCliLoginWriteResult {
  return { status: 'error', error: 'Unable to switch the Kiro CLI login' }
}

const readSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('missing') }),
  z.object({ status: z.literal('error'), error: z.string() }),
  z.object({ status: z.literal('ok'), contents: z.string() })
])

const writeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('conflict') }),
  z.object({ status: z.literal('error'), error: z.string() })
])

// Validate structured-clone replies at the worker boundary.
export function parseKiroCliLoginReadResult(value: unknown): KiroCliLoginReadResult | null {
  const parsed = readSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseKiroCliLoginWriteResult(value: unknown): KiroCliLoginWriteResult | null {
  const parsed = writeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
