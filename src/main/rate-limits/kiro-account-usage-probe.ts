import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { abortSignalWithTimeout } from '../lib/abort-signal-with-timeout'
import {
  decodeKiroCliLogin,
  encodeKiroCliLogin,
  readKiroCliDeviceRegistration,
  readKiroCliLoginToken,
  withRefreshedKiroCliToken,
  type KiroCliLoginToken
} from '../kiro/kiro-cli-login'
import { requestKiroUsageLimits } from './kiro-usage-fetcher'

export type KiroSavedLogins = {
  read(accountId: string): Promise<string | null>
  update(accountId: string, previous: string, next: string): Promise<void>
}

const TOKEN_SKEW_MS = 60_000
const REFRESH_TIMEOUT_MS = 15_000
// Why: the region comes from a login another app wrote; only a real AWS region may pick the host.
const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d$/

function expired(token: KiroCliLoginToken): boolean {
  return token.expiresAtMs !== null && token.expiresAtMs - Date.now() <= TOKEN_SKEW_MS
}

function failure(error: string): ProviderRateLimits {
  return {
    provider: 'kiro',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: Date.now(),
    error,
    status: 'error',
    usageMetadata: { source: 'oauth', failureKind: 'delegated-refresh-required' }
  }
}

/** AWS SSO OIDC refresh, as kiro-cli does it for Builder ID and IAM Identity Center logins. */
async function refreshOidcToken(
  token: KiroCliLoginToken,
  registration: { clientId: string; clientSecret: string },
  signal?: AbortSignal
): Promise<Pick<KiroCliLoginToken, 'accessToken' | 'refreshToken' | 'expiresAtMs'> | null> {
  if (!token.refreshToken || !AWS_REGION_PATTERN.test(token.region)) {
    return null
  }
  const response = await fetch(`https://oidc.${token.region}.amazonaws.com/token`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      grantType: 'refresh_token',
      refreshToken: token.refreshToken
    }),
    signal: abortSignalWithTimeout(signal, REFRESH_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('accessToken' in body)) {
    return null
  }
  const accessToken = body.accessToken
  const expiresIn = 'expiresIn' in body ? body.expiresIn : null
  const refreshToken = 'refreshToken' in body ? body.refreshToken : null
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null
  }
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : null,
    expiresAtMs: typeof expiresIn === 'number' ? Date.now() + expiresIn * 1000 : null
  }
}

/**
 * Reads a saved Kiro account's credits without switching kiro-cli to it. An expired Builder ID or
 * Identity Center token is refreshed against the saved login, which only Orca holds while inactive.
 */
export async function probeKiroAccountUsage(
  accountId: string,
  logins: KiroSavedLogins,
  signal?: AbortSignal
): Promise<ProviderRateLimits | null> {
  const saved = await logins.read(accountId)
  if (!saved) {
    return null
  }
  let rows = decodeKiroCliLogin(saved)
  let token = readKiroCliLoginToken(rows)
  if (!token) {
    return null
  }
  if (expired(token)) {
    const registration = readKiroCliDeviceRegistration(rows, token.tokenKey)
    const refreshed = registration
      ? await refreshOidcToken(token, registration, signal).catch(() => null)
      : null
    if (!refreshed) {
      return failure('Kiro sign-in expired — switch to this account and run kiro-cli to renew it.')
    }
    rows = withRefreshedKiroCliToken(rows, { ...refreshed, tokenKey: token.tokenKey })
    await logins.update(accountId, saved, encodeKiroCliLogin(rows)).catch((error: unknown) => {
      console.warn('[rate-limits] Could not save the refreshed Kiro login:', error)
    })
    token = readKiroCliLoginToken(rows)
    if (!token) {
      return null
    }
  }
  const { limits } = await requestKiroUsageLimits(
    {
      accessToken: token.accessToken,
      expiresAtMs: token.expiresAtMs,
      region: token.region,
      source: 'cli'
    },
    signal
  )
  return limits
}
