import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBridgeHubAntigravityLogins } from './bridge-hub-antigravity-accounts'
import { parseAntigravityNativeCredential } from './native-credential-codec'
import { harness } from './native-account-test-fixtures'

function bridgeHubFile(accounts: unknown[]): string {
  const path = join(
    mkdtempSync(join(tmpdir(), 'orca-bridge-hub-')),
    'antigravity-cli-accounts.json'
  )
  writeFileSync(path, JSON.stringify({ version: 1, accounts, activeIndex: 0 }))
  return path
}

describe('Bridge Hub Antigravity import', () => {
  it('turns each saved account into an agy login and skips ones without a refresh token', () => {
    const logins = readBridgeHubAntigravityLogins(
      bridgeHubFile([
        { email: 'one@example.invalid', refreshToken: 'r1', accessToken: 'a1', expiresAt: 1 },
        { email: 'two@example.invalid', refreshToken: '' }
      ])
    )
    expect(logins).toHaveLength(1)
    expect(logins[0].email).toBe('one@example.invalid')
    const credential = parseAntigravityNativeCredential(logins[0].contents)
    expect(credential).toMatchObject({ authMethod: 'consumer', refreshToken: 'r1' })
  })

  it('saves new accounts once and leaves ones already saved alone', async () => {
    const h = harness()
    await h.service.addCurrentAccount().catch(() => undefined)
    const logins = readBridgeHubAntigravityLogins(
      bridgeHubFile([
        { email: 'one@example.invalid', refreshToken: 'r1', accessToken: 'a1', expiresAt: 1 },
        { email: 'a@example.invalid', refreshToken: 'r-other', accessToken: 'a2', expiresAt: 1 }
      ])
    )

    const first = await h.service.importLogins(logins)
    const again = await h.service.importLogins(logins)

    expect(first.imported).toBe(1)
    expect(again).toMatchObject({ imported: 0, skipped: 2 })
    expect(first.state.accounts.map((account) => account.email)).toContain('one@example.invalid')
    expect(h.getVault().accounts).toHaveLength(2)
  })
})
