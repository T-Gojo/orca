// Keep this Electron-free: the foreign SQLite worker encodes the login it reads with it.

/** auth_kv rows that make up one kiro-cli login; the Q-era keys are kept by older installs. */
export const KIRO_LOGIN_AUTH_KEYS = [
  'kirocli:odic:token',
  'kirocli:odic:device-registration',
  'kirocli:social:token',
  'kirocli:external-idp:token',
  'codewhisperer:odic:token',
  'codewhisperer:odic:device-registration'
] as const

/** state rows that say where the login signs in (IAM Identity Center site, region, profile). */
export const KIRO_LOGIN_STATE_KEYS = [
  'auth.idc.start-url',
  'auth.idc.region',
  'api.codewhisperer.profile'
] as const

const TOKEN_KEYS = [
  'kirocli:odic:token',
  'kirocli:social:token',
  'kirocli:external-idp:token',
  'codewhisperer:odic:token'
] as const

export type KiroCliLoginRows = {
  auth: Record<string, string>
  state: Record<string, string>
}

export type KiroCliLoginToken = {
  /** odic (Builder ID, IAM Identity Center), social (Google, GitHub) or external-idp. */
  authMethod: string
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
  region: string
  tokenKey: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRows(value: unknown, keys: readonly string[]): Record<string, string> | null {
  if (!isRecord(value)) {
    return null
  }
  const rows: Record<string, string> = {}
  for (const key of keys) {
    const row = value[key]
    if (row === undefined) {
      continue
    }
    if (typeof row !== 'string') {
      return null
    }
    rows[key] = row
  }
  return rows
}

function sorted(rows: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))
}

/** Canonical so two reads of the same login always compare equal. */
export function encodeKiroCliLogin(rows: KiroCliLoginRows): string {
  return JSON.stringify({ auth: sorted(rows.auth), state: sorted(rows.state) })
}

export function decodeKiroCliLogin(contents: string): KiroCliLoginRows {
  const value: unknown = JSON.parse(contents)
  const auth = isRecord(value) ? pickRows(value.auth, KIRO_LOGIN_AUTH_KEYS) : null
  const state = isRecord(value) ? pickRows(value.state, KIRO_LOGIN_STATE_KEYS) : null
  if (!auth || !state || !hasKiroCliLoginToken(auth)) {
    throw new Error('The saved Kiro login is invalid.')
  }
  return { auth, state }
}

export function hasKiroCliLoginToken(auth: Record<string, string>): boolean {
  return TOKEN_KEYS.some((key) => auth[key] !== undefined)
}

function stringField(record: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

function parseExpiresAtMs(value: string | null): number | null {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

function stateString(rows: KiroCliLoginRows, key: string): string | null {
  try {
    const value: unknown = JSON.parse(rows.state[key] ?? 'null')
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** The login's token: odic rows use snake_case, social and external-idp rows camelCase. */
export function readKiroCliLoginToken(rows: KiroCliLoginRows): KiroCliLoginToken | null {
  for (const tokenKey of TOKEN_KEYS) {
    const raw = rows.auth[tokenKey]
    if (!raw) {
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isRecord(value)) {
      continue
    }
    const accessToken = stringField(value, 'access_token', 'accessToken')
    if (!accessToken) {
      continue
    }
    return {
      authMethod: tokenKey.split(':')[1] ?? 'odic',
      accessToken,
      refreshToken: stringField(value, 'refresh_token', 'refreshToken'),
      expiresAtMs: parseExpiresAtMs(stringField(value, 'expires_at', 'expiresAt')),
      region: stringField(value, 'region') ?? stateString(rows, 'auth.idc.region') ?? 'us-east-1',
      tokenKey
    }
  }
  return null
}

/** The OIDC client an odic login refreshes with; null for social and external-idp logins. */
export function readKiroCliDeviceRegistration(
  rows: KiroCliLoginRows,
  tokenKey: string
): { clientId: string; clientSecret: string } | null {
  const raw = rows.auth[tokenKey.replace(/:token$/, ':device-registration')]
  if (!raw || !tokenKey.endsWith(':odic:token')) {
    return null
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) {
      return null
    }
    const clientId = stringField(value, 'client_id')
    const clientSecret = stringField(value, 'client_secret')
    return clientId && clientSecret ? { clientId, clientSecret } : null
  } catch {
    return null
  }
}

/** The login with its token replaced, keeping every field kiro-cli wrote that Orca does not read. */
export function withRefreshedKiroCliToken(
  rows: KiroCliLoginRows,
  token: Pick<KiroCliLoginToken, 'tokenKey' | 'accessToken' | 'refreshToken' | 'expiresAtMs'>
): KiroCliLoginRows {
  const value: unknown = JSON.parse(rows.auth[token.tokenKey] ?? '{}')
  if (!isRecord(value)) {
    return rows
  }
  const snake = 'access_token' in value
  const next: Record<string, unknown> = { ...value }
  next[snake ? 'access_token' : 'accessToken'] = token.accessToken
  if (token.refreshToken) {
    next[snake ? 'refresh_token' : 'refreshToken'] = token.refreshToken
  }
  if (token.expiresAtMs !== null) {
    next[snake ? 'expires_at' : 'expiresAt'] = new Date(token.expiresAtMs).toISOString()
  }
  return { ...rows, auth: { ...rows.auth, [token.tokenKey]: JSON.stringify(next) } }
}
