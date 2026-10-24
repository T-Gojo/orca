import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import { abortSignalWithTimeout } from '../lib/abort-signal-with-timeout'
import type {
  ProviderRateLimits,
  RateLimitWindow,
  UsageRateLimitFailureKind
} from '../../shared/rate-limit-types'
import {
  isKiroAccessTokenFresh,
  readKiroAuthSession,
  type KiroAuthReadResult,
  type KiroAuthSession
} from './kiro-auth'
import { classifyThrownUsageRequestError } from './usage-request-failure-kind'

const API_TIMEOUT_MS = 15_000
const MONTH_MINUTES = 30 * 24 * 60
// Why: the region comes from a file another app writes; only a real AWS region may pick the host.
const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function result(
  status: 'error' | 'unavailable',
  error: string,
  failureKind: UsageRateLimitFailureKind,
  credentialSource?: string
): ProviderRateLimits {
  return {
    provider: 'kiro',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: Date.now(),
    error,
    status,
    usageMetadata: { source: 'oauth', failureKind, credentialSource }
  }
}

type CreditPool = { used: number; limit: number }

function readPool(value: unknown, usedKey: string, limitKey: string): CreditPool | null {
  if (!isRecord(value)) {
    return null
  }
  const used = asNumber(value[`${usedKey}WithPrecision`]) ?? asNumber(value[usedKey])
  const limit = asNumber(value[`${limitKey}WithPrecision`]) ?? asNumber(value[limitKey])
  return used === null || limit === null ? null : { used, limit }
}

function isActive(value: Record<string, unknown>, statusKey: string): boolean {
  const status = value[statusKey]
  return status === undefined || status === null || status === 'ACTIVE'
}

/** Sum the plan pool with any active trial and bonus credits, which Kiro spends first. */
export function mapKiroCreditWindow(payload: unknown): RateLimitWindow | null {
  if (!isRecord(payload) || !Array.isArray(payload.usageBreakdownList)) {
    return null
  }
  const breakdowns = payload.usageBreakdownList.filter(isRecord)
  const breakdown =
    breakdowns.find((entry) => entry.resourceType === 'CREDIT') ?? breakdowns[0] ?? null
  if (!breakdown) {
    return null
  }
  const pools: CreditPool[] = []
  const plan = readPool(breakdown, 'currentUsage', 'usageLimit')
  if (plan) {
    pools.push(plan)
  }
  const trial = breakdown.freeTrialInfo
  if (isRecord(trial) && isActive(trial, 'freeTrialStatus')) {
    const pool = readPool(trial, 'currentUsage', 'usageLimit')
    if (pool) {
      pools.push(pool)
    }
  }
  const bonuses = Array.isArray(breakdown.bonuses) ? breakdown.bonuses.filter(isRecord) : []
  for (const bonus of bonuses) {
    const pool = isActive(bonus, 'status') ? readPool(bonus, 'currentUsage', 'usageLimit') : null
    if (pool) {
      pools.push(pool)
    }
  }
  const limit = pools.reduce((sum, pool) => sum + pool.limit, 0)
  if (limit <= 0) {
    return null
  }
  const used = pools.reduce((sum, pool) => sum + pool.used, 0)
  const resetSeconds = asNumber(breakdown.nextDateReset) ?? asNumber(payload.nextDateReset)
  return {
    usedPercent: Math.min(100, Math.max(0, (used / limit) * 100)),
    windowMinutes: MONTH_MINUTES,
    resetsAt: resetSeconds !== null && resetSeconds > 0 ? resetSeconds * 1000 : null,
    resetDescription: null
  }
}

function readPlanTitle(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.subscriptionInfo)) {
    return null
  }
  const title = payload.subscriptionInfo.subscriptionTitle
  return typeof title === 'string' && title.length > 0 ? title : null
}

async function requestUsageLimits(
  session: KiroAuthSession,
  signal?: AbortSignal
): Promise<ProviderRateLimits> {
  const region = AWS_REGION_PATTERN.test(session.region) ? session.region : 'us-east-1'
  const url = `https://q.${region}.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
      signal: abortSignalWithTimeout(signal, API_TIMEOUT_MS)
    })
  } catch (error) {
    return result(
      'error',
      'Kiro usage request failed',
      classifyThrownUsageRequestError(error),
      session.source
    )
  }

  if (response.status === 401 || response.status === 403) {
    await cancelUnreadResponseBody(response)
    return result(
      'error',
      'Kiro sign-in expired — run kiro-cli on the computer running Orca.',
      'delegated-refresh-required',
      session.source
    )
  }
  if (response.status === 429) {
    await cancelUnreadResponseBody(response)
    return result('error', 'Kiro usage is rate limited', 'rate-limited', session.source)
  }
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    return result(
      'error',
      `Kiro usage request failed (${response.status})`,
      'server',
      session.source
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return result('error', 'Could not parse Kiro usage response', 'parse', session.source)
  }
  const monthly = mapKiroCreditWindow(payload)
  if (!monthly) {
    return result(
      'unavailable',
      'Kiro did not report a credit allowance for this account',
      'usage-unavailable',
      session.source
    )
  }
  return {
    provider: 'kiro',
    session: null,
    weekly: null,
    monthly,
    planType: readPlanTitle(payload),
    updatedAt: Date.now(),
    error: null,
    status: 'ok',
    usageMetadata: { source: 'oauth', credentialSource: session.source }
  }
}

// Why: Orca only reads the token kiro-cli / Kiro IDE maintain; it never signs in or refreshes.
export async function fetchKiroRateLimits(
  options: { signal?: AbortSignal; authReadResult?: KiroAuthReadResult } = {}
): Promise<ProviderRateLimits> {
  const readResult = options.authReadResult ?? (await readKiroAuthSession())
  if (readResult.status === 'missing') {
    return result(
      'unavailable',
      'Not signed in to Kiro — run kiro-cli login',
      'missing-credentials'
    )
  }
  if (readResult.status === 'error') {
    return result('error', readResult.error, 'parse')
  }
  const session = readResult.session
  if (!isKiroAccessTokenFresh(session)) {
    return result(
      'error',
      'Kiro sign-in expired — run kiro-cli on the computer running Orca.',
      'delegated-refresh-required',
      session.source
    )
  }
  return requestUsageLimits(session, options.signal)
}
