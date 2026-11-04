import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeCredentialFileAtomic } from '../credentials/integration-credential-file'
import { ANTIGRAVITY_ACP_COMMAND, ANTIGRAVITY_ACP_VERSION } from './antigravity-acp-runtime'
import { createAntigravityHostCredentialBackend } from './native-credential-backend'

type OAuthClient = { clientId: string; clientSecret: string }
type SeedDeps = {
  readLogin: () => Promise<{ contents: string; refreshToken: string | null } | null>
  readClient: (serverPath: string, clientId: string) => Promise<OAuthClient | null>
}

const SCAN_CHUNK_BYTES = 16 * 1024 * 1024
const clients = new Map<string, OAuthClient | null>()

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The Google OAuth client that issued an agy login, read from its id token's audience. */
export function antigravityLoginClientId(contents: string): string | null {
  try {
    const value: unknown = JSON.parse(contents)
    const idToken = isRecord(value)
      ? (value.id_token ?? (isRecord(value.token) ? value.token.id_token : undefined))
      : undefined
    const payload = typeof idToken === 'string' ? idToken.split('.')[1] : undefined
    const claims: unknown = payload
      ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      : null
    const aud = isRecord(claims) ? claims.aud : null
    return typeof aud === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(aud)
      ? aud
      : null
  } catch {
    return null
  }
}

/**
 * Finds that client's installed-app secret in the chat server, which stores the two as adjacent
 * Python string constants. Why read it there: the secret then never lives in Orca's source.
 */
export async function readAntigravityServerClient(
  serverPath: string,
  clientId: string
): Promise<OAuthClient | null> {
  const stat = statSync(serverPath)
  const key = `${serverPath}:${stat.size}:${stat.mtimeMs}:${clientId}`
  if (clients.has(key)) {
    return clients.get(key) ?? null
  }
  const needle = Buffer.from(`${clientId}z`)
  const handle = await open(serverPath, 'r')
  let found: OAuthClient | null = null
  try {
    const buffer = Buffer.alloc(SCAN_CHUNK_BYTES + 256)
    for (let position = 0; position < stat.size && !found; position += SCAN_CHUNK_BYTES) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      const chunk = buffer.subarray(0, bytesRead)
      for (let at = chunk.indexOf(needle); at !== -1; at = chunk.indexOf(needle, at + 1)) {
        const lengthAt = at + needle.length
        const secret = chunk
          .subarray(lengthAt + 1, lengthAt + 1 + (chunk[lengthAt] ?? 0))
          .toString()
        if (/^GOCSPX-[\w-]{20,}$/.test(secret)) {
          found = { clientId, clientSecret: secret }
          break
        }
      }
    }
  } finally {
    await handle.close()
  }
  clients.set(key, found)
  return found
}

const defaultDeps: SeedDeps = {
  readLogin: () => createAntigravityHostCredentialBackend(homedir()).read(),
  readClient: readAntigravityServerClient
}

/**
 * Signs Antigravity chats in with the account agy is signed in to. Chats keep their own token file,
 * but agy issues logins from the same Google client, so its refresh token serves both. A token the
 * user signed in to from a chat is never replaced; only one Orca wrote follows agy's account.
 */
export async function seedAntigravityChatLogin(
  geminiHome: string,
  deps: SeedDeps = defaultDeps
): Promise<void> {
  const tokenPath = join(geminiHome, 'antigravity-acp', 'acp_token.json')
  const markerPath = join(geminiHome, 'antigravity-acp', 'orca-seeded-login')
  const login = await deps.readLogin()
  if (!login?.refreshToken) {
    return
  }
  if (existsSync(tokenPath)) {
    const current: unknown = JSON.parse(readFileSync(tokenPath, 'utf8'))
    const refresh = isRecord(current) ? current.refresh_token : null
    const marker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : null
    if (typeof refresh !== 'string' || marker !== digest(refresh)) {
      return
    }
    if (refresh === login.refreshToken) {
      return
    }
  }
  const clientId = antigravityLoginClientId(login.contents)
  const serverPath = join(
    dirname(geminiHome),
    'agent-runtimes',
    'antigravity',
    ANTIGRAVITY_ACP_VERSION,
    ANTIGRAVITY_ACP_COMMAND
  )
  const client =
    clientId && existsSync(serverPath) ? await deps.readClient(serverPath, clientId) : null
  if (!client) {
    return
  }
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 })
  // google-auth's authorized-user shape; the server refreshes the access token on first use.
  const token = {
    refresh_token: login.refreshToken,
    token_uri: 'https://oauth2.googleapis.com/token',
    client_id: client.clientId,
    client_secret: client.clientSecret
  }
  writeCredentialFileAtomic(tokenPath, Buffer.from(JSON.stringify(token), 'utf8'))
  writeFileSync(markerPath, digest(login.refreshToken), { mode: 0o600 })
}
