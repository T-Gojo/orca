import { chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import {
  CLAUDE_TERMINAL_ACCOUNT_PIN_ENV,
  CODEX_TERMINAL_ACCOUNT_PIN_ENV,
  encodeTerminalAccountPin
} from '../../shared/agent-terminal-account-pin'
import type { DelegationAgent } from '../../shared/delegation/delegation-types'
import { getAntigravityAccountService } from '../antigravity/native-account-host'
import { parseAntigravityNativeCredential } from '../antigravity/native-credential-codec'
import { getKiroAccountService } from '../kiro/kiro-account-host'
import { decodeKiroCliLogin, readKiroCliLoginToken } from '../kiro/kiro-cli-login'
import {
  readKiroCliLogin,
  writeKiroCliLogin
} from '../foreign-sqlite-readers/foreign-sqlite-reader-spawn'
import { getKiroCliDbPath } from '../rate-limits/kiro-auth'
import {
  copySqliteDatabase,
  mirrorDirectoryExcept,
  pathUnderHome,
  prepareOverlayHome
} from './delegation-overlay-home'

const AGY_TOKEN_FILE = 'antigravity-oauth-token'
// Why: agy then keeps its login in the file under $HOME, not the OS keychain every agy shares.
const AGY_FILE_LOGIN_ENV = { SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' }

function overlayRoot(agent: DelegationAgent, accountId: string): string {
  if (!/^[\w-]{1,128}$/.test(accountId)) {
    throw new Error(`Invalid ${agent} account id: ${accountId}`)
  }
  return join(getAppEnvironment().getPath('userData'), 'delegation-homes', agent, accountId)
}

function refuseOnWindows(agent: DelegationAgent): void {
  if (process.platform === 'win32') {
    throw new Error(
      `Running ${agent} workers on a chosen saved account is not supported on Windows yet; omit --account to use its current login.`
    )
  }
}

/**
 * HOME for the worker. On macOS Orca starts shells through `login`, which resets HOME; its
 * trampoline restores it from ORCA_ACCOUNT_HOME (tcc-login-shell.ts).
 */
function accountHomeEnv(home: string): Record<string, string> {
  return { HOME: home, ORCA_ACCOUNT_HOME: home }
}

function sameAgyGrant(a: string, b: string): boolean {
  try {
    return (
      parseAntigravityNativeCredential(a).refreshToken ===
      parseAntigravityNativeCredential(b).refreshToken
    )
  } catch {
    return false
  }
}

async function antigravityEnv(accountId: string): Promise<Record<string, string>> {
  refuseOnWindows('antigravity')
  const service = await getAntigravityAccountService({ runtime: 'host' })
  const saved = await service.readSavedCredential(accountId)
  if (!saved) {
    throw new Error(`Antigravity account ${accountId} is not saved in Orca.`)
  }
  const { home, ownDirectory } = await prepareOverlayHome({
    root: overlayRoot('antigravity', accountId),
    ownPath: join('.gemini', 'antigravity-cli')
  })
  await mirrorDirectoryExcept(join(homedir(), '.gemini', 'antigravity-cli'), ownDirectory, [
    AGY_TOKEN_FILE
  ])
  const tokenPath = join(ownDirectory, AGY_TOKEN_FILE)
  const current = await readFile(tokenPath, 'utf8').catch(() => null)
  if (current !== null && sameAgyGrant(current, saved)) {
    if (current !== saved) {
      // agy refreshed the token in this home; keep Orca's saved copy as current as the one it used.
      await service.updateSavedCredential(accountId, saved, current).catch(() => undefined)
    }
  } else {
    await writeFile(tokenPath, saved, { mode: 0o600 })
    await chmod(tokenPath, 0o600)
  }
  return { ...accountHomeEnv(home), ...AGY_FILE_LOGIN_ENV }
}

function kiroRefreshToken(contents: string): string | null {
  try {
    return readKiroCliLoginToken(decodeKiroCliLogin(contents))?.refreshToken ?? null
  } catch {
    return null
  }
}

async function kiroEnv(accountId: string): Promise<Record<string, string>> {
  refuseOnWindows('kiro')
  const service = getKiroAccountService()
  const saved = await service.readSavedLogin(accountId)
  if (!saved) {
    throw new Error(`Kiro account ${accountId} is not saved in Orca.`)
  }
  const realDb = getKiroCliDbPath()
  const dbUnderHome = pathUnderHome(realDb)
  if (!dbUnderHome) {
    throw new Error(`kiro-cli keeps its login outside the home folder (${realDb}).`)
  }
  const { home, ownDirectory } = await prepareOverlayHome({
    root: overlayRoot('kiro', accountId),
    ownPath: dirname(dbUnderHome)
  })
  const dbName = realDb.slice(dirname(realDb).length + 1)
  await mirrorDirectoryExcept(dirname(realDb), ownDirectory, [dbName, '.refresh.lock'])
  const overlayDb = join(ownDirectory, dbName)
  const existing = await readKiroCliLogin(overlayDb)
  if (existing.status === 'missing' && !(await readFile(overlayDb).catch(() => null))) {
    await copySqliteDatabase(realDb, overlayDb)
  }
  const current = await readKiroCliLogin(overlayDb)
  const currentContents = current.status === 'ok' ? current.contents : null
  if (currentContents && kiroRefreshToken(currentContents) === kiroRefreshToken(saved)) {
    if (currentContents !== saved) {
      await service.updateSavedLogin(accountId, saved, currentContents).catch(() => undefined)
    }
  } else {
    const written = await writeKiroCliLogin(overlayDb, saved, currentContents)
    if (written.status !== 'ok') {
      throw new Error(`Could not prepare kiro-cli for account ${accountId} (${written.status}).`)
    }
  }
  return accountHomeEnv(home)
}

/** The env a worker of `agent` needs to run on a saved account; null id is the agent's own login. */
export async function delegationAccountEnv(
  agent: DelegationAgent,
  accountId: string | null
): Promise<Record<string, string>> {
  if (agent === 'claude') {
    return { [CLAUDE_TERMINAL_ACCOUNT_PIN_ENV]: encodeTerminalAccountPin(accountId) }
  }
  if (agent === 'codex') {
    return { [CODEX_TERMINAL_ACCOUNT_PIN_ENV]: encodeTerminalAccountPin(accountId) }
  }
  if (accountId === null) {
    return {}
  }
  return agent === 'antigravity' ? antigravityEnv(accountId) : kiroEnv(accountId)
}
