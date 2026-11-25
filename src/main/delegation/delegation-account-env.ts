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
// Fork: mistral-vibe workers run on a per-terminal env pin, no overlay home (FORK.md §8).
import { getMistralAccountService } from '../mistral/mistral-account-host'
// Fork: opencode workers run on upstream's managed-data-account env request (FORK.md §8).
import {
  MANAGED_DATA_ACCOUNT_RESUME_ENV,
  SYSTEM_DATA_ACCOUNT_RESUME_ID
} from '../../shared/agent-launch/environment/managed-data-account-resume'
import { getManagedDataAccountService } from '../managed-data-accounts/service'
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

/**
 * Fork: a mistral-vibe worker's account is the saved API key in `MISTRAL_API_KEY` — env outranks
 * `$VIBE_HOME/.env` and the keychain, and each worker gets its own spawn env, so parallel workers
 * on different accounts are isolated with no overlay home (and no Windows refusal; see FORK.md §8).
 */
async function mistralEnv(accountId: string): Promise<Record<string, string>> {
  const key = await getMistralAccountService().readAccountApiKey(accountId)
  if (!key) {
    throw new Error(`Mistral account ${accountId} is not saved in Orca.`)
  }
  return { MISTRAL_API_KEY: key }
}

/**
 * Fork: an opencode worker's account rides upstream's managed-data-account launch machinery: the
 * spawn env requests the account's store by id (`ORCA_DATA_ACCOUNT_ID`), which opencode's host-env
 * assembly turns into the per-account XDG overlay. `system` requests the machine's own store —
 * without it an active saved account's overlay would apply. Env only, so Windows is fine (FORK.md §8).
 */
async function opencodeEnv(accountId: string | null): Promise<Record<string, string>> {
  if (accountId === null) {
    return { [MANAGED_DATA_ACCOUNT_RESUME_ENV]: SYSTEM_DATA_ACCOUNT_RESUME_ID }
  }
  const known = getManagedDataAccountService()
    .list('opencode')
    .accounts.some((account) => account.id.toLowerCase() === accountId.toLowerCase())
  if (!known) {
    throw new Error(`OpenCode account ${accountId} is no longer saved in Orca.`)
  }
  return { [MANAGED_DATA_ACCOUNT_RESUME_ENV]: accountId }
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
  if (agent === 'opencode') {
    return opencodeEnv(accountId)
  }
  if (accountId === null) {
    // Fork: `--account system` on mistral-vibe injects nothing; the machine default key wins.
    return {}
  }
  if (agent === 'antigravity') {
    return antigravityEnv(accountId)
  }
  if (agent === 'kiro') {
    return kiroEnv(accountId)
  }
  return mistralEnv(accountId)
}
