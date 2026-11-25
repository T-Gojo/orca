import type { ProviderRateLimits } from '../../shared/agent-usage/rate-limits/rate-limit-types'
import { abortSignalWithTimeout } from '../lib/abort-signal-with-timeout'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import { getMainHttpClient } from '../network/http-client'

export type MistralSavedLogins = {
  read(accountId: string): Promise<string | null>
  /** Shape parity with the Kiro probe; Mistral API keys never rotate, so nothing is ever written back. */
  update(accountId: string, previous: string, next: string): Promise<void>
}

const API_TIMEOUT_MS = 15_000
const SUBSCRIPTION_TIMEOUT_MS = 5_000
const BUDGET_URL = 'https://api.mistral.ai/v1/billing/budget'
const SUBSCRIPTION_URL = 'https://api.mistral.ai/v1/billing/subscription'

function result(
  status: 'unavailable' | 'error',
  error: string,
  failureKind: 'missing-scope' | 'network' | 'server' | 'parse' | 'usage-unavailable'
): ProviderRateLimits {
  return {
    provider: 'mistral',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error,
    status,
    usageMetadata: { failureKind }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `reset_at` as unix ms; strings parse as dates, numbers are taken as seconds until ms-scale. */
function resetAtMsOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

type VibeBudget = { usedPercent: number; resetAtMs: number | null }

/** The Vibe quota pool; anything else means Mistral did not report one for this key. */
function budgetOf(body: unknown): VibeBudget | null {
  const budget = isRecord(body) && isRecord(body.vibe_budget) ? body.vibe_budget : null
  const usedPercent = budget?.usage_percentage
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
    return null
  }
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetAtMs: budget ? resetAtMsOf(budget.reset_at) : null
  }
}

async function readJson(url: string, apiKey: string, timeoutMs: number, signal?: AbortSignal) {
  try {
    return {
      ok: true as const,
      response: await getMainHttpClient().fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: abortSignalWithTimeout(signal, timeoutMs)
      })
    }
  } catch {
    return { ok: false as const, response: null }
  }
}

/** Best-effort plan name from the subscription read; a failure never fails the quota reading. */
async function readPlanName(apiKey: string, signal?: AbortSignal): Promise<string | null> {
  const { ok, response } = await readJson(SUBSCRIPTION_URL, apiKey, SUBSCRIPTION_TIMEOUT_MS, signal)
  if (!ok || !response) {
    return null
  }
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    return null
  }
  try {
    const body: unknown = await response.json()
    const planName = isRecord(body) ? body.plan_name : undefined
    return typeof planName === 'string' && planName.length > 0 ? planName : null
  } catch {
    return null
  }
}

/**
 * Reads a saved Mistral Vibe account's quota with its own API key: `GET /v1/billing/budget`
 * (a 403 means the account lacks `see_org_inference_usage`, so its usage is unreadable, not
 * its key invalid) and, best-effort, `GET /v1/billing/subscription` for the plan name.
 */
export async function probeMistralAccountUsage(
  accountId: string,
  logins: MistralSavedLogins,
  signal?: AbortSignal
): Promise<ProviderRateLimits | null> {
  const apiKey = await logins.read(accountId)
  if (!apiKey) {
    return null
  }
  const { ok, response } = await readJson(BUDGET_URL, apiKey, API_TIMEOUT_MS, signal)
  if (!ok || !response) {
    return result('error', 'Mistral usage request failed', 'network')
  }
  if (response.status === 403) {
    await cancelUnreadResponseBody(response)
    return result(
      'unavailable',
      'This Mistral account is not allowed to read its own usage (missing see_org_inference_usage)',
      'missing-scope'
    )
  }
  if (response.status === 401) {
    await cancelUnreadResponseBody(response)
    return result('error', 'Mistral rejected the saved API key', 'server')
  }
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    return result('error', `Mistral usage request failed (${response.status})`, 'server')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return result('error', 'Could not parse the Mistral usage response', 'parse')
  }
  const budget = budgetOf(body)
  if (!budget) {
    return result(
      'unavailable',
      'Mistral did not report a Vibe budget for this account',
      'usage-unavailable'
    )
  }
  return {
    provider: 'mistral',
    session: null,
    weekly: null,
    monthly: {
      usedPercent: budget.usedPercent,
      // Mistral names only the reset, not the period start; the remaining time is the closest window length.
      windowMinutes:
        budget.resetAtMs !== null
          ? Math.max(1, Math.round((budget.resetAtMs - Date.now()) / 60_000))
          : 30 * 24 * 60,
      resetsAt: budget.resetAtMs,
      resetDescription: null
    },
    planType: await readPlanName(apiKey, signal),
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}
