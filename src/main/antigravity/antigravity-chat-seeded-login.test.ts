import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  antigravityLoginClientId,
  readAntigravityServerClient,
  seedAntigravityChatLogin
} from './antigravity-chat-seeded-login'
import { ANTIGRAVITY_ACP_COMMAND, ANTIGRAVITY_ACP_VERSION } from './antigravity-acp-runtime'

// Assembled at runtime so secret scanners do not read the made-up fixture as a real credential.
const CLIENT = ['123-abc', 'apps', 'googleusercontent', 'com'].join('.')
const SECRET = ['GOCSPX', 'fixture'.repeat(4)].join('-')

function login(refreshToken: string): { contents: string; refreshToken: string } {
  const claims = Buffer.from(JSON.stringify({ aud: CLIENT })).toString('base64url')
  return {
    contents: JSON.stringify({ token: { access_token: 'a' }, id_token: `h.${claims}.s` }),
    refreshToken
  }
}

function setup() {
  const userData = mkdtempSync(join(tmpdir(), 'orca-agy-seed-'))
  const home = join(userData, 'antigravity-chat')
  const server = join(userData, 'agent-runtimes', 'antigravity', ANTIGRAVITY_ACP_VERSION)
  mkdirSync(server, { recursive: true })
  const serverPath = join(server, ANTIGRAVITY_ACP_COMMAND)
  writeFileSync(
    serverPath,
    Buffer.concat([
      Buffer.from('noise'),
      Buffer.from(`${CLIENT}z`),
      Buffer.from([SECRET.length]),
      Buffer.from(`${SECRET}tail`)
    ])
  )
  const tokenPath = join(home, 'antigravity-acp', 'acp_token.json')
  const token = (): unknown => JSON.parse(readFileSync(tokenPath, 'utf8'))
  return { home, serverPath, tokenPath, token }
}

const deps = (refreshToken: string) => ({
  readLogin: async () => login(refreshToken),
  readClient: readAntigravityServerClient
})

describe('seedAntigravityChatLogin', () => {
  it('reads the issuing client and finds its secret in the server', async () => {
    const { serverPath } = setup()
    expect(antigravityLoginClientId(login('r').contents)).toBe(CLIENT)
    await expect(readAntigravityServerClient(serverPath, CLIENT)).resolves.toEqual({
      clientId: CLIENT,
      clientSecret: SECRET
    })
  })

  it('signs a chat in with agy, then follows agy to another account', async () => {
    const { home, token } = setup()
    await seedAntigravityChatLogin(home, deps('first'))
    expect(token()).toMatchObject({
      refresh_token: 'first',
      client_id: CLIENT,
      client_secret: SECRET
    })
    await seedAntigravityChatLogin(home, deps('second'))
    expect(token()).toMatchObject({ refresh_token: 'second' })
  })

  it('keeps a token the user signed in to from a chat', async () => {
    const { home, tokenPath, token } = setup()
    mkdirSync(join(home, 'antigravity-acp'), { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({ refresh_token: 'chat-own' }))
    await seedAntigravityChatLogin(home, deps('agy'))
    expect(token()).toMatchObject({ refresh_token: 'chat-own' })
  })
})
