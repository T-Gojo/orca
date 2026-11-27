import { credentialFileExists } from '../credentials/credential-file-io'
import { resolve } from 'node:path'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-status/process/agent-process-recognition'
import { isAntigravityFileStorageHost } from './native-credential-backend'
import { createEncryptedAntigravityAccountStore } from './native-account-store'
import { getAntigravityAccountService, getAntigravityAccountVaultPath } from './native-account-host'

export async function prepareAntigravityAccountForLaunch(args: {
  launchAgent?: string
  command?: string
  connectionId?: string | null
  isWsl?: boolean
  env?: NodeJS.ProcessEnv
  envIsComplete?: boolean
  envToDelete?: readonly string[]
}): Promise<void> {
  // Windows account selection applies the host default; the shell and agent own each launch.
  if (process.platform === 'win32') {
    return
  }
  const agent =
    args.launchAgent ??
    (args.command ? recognizeAgentProcessFromCommandLine(args.command)?.agent : null)
  // Client snapshots never select accounts for a relay or a client-selected distro.
  if (agent !== 'antigravity' || args.connectionId || args.isWsl) {
    return
  }
  const path = getAntigravityAccountVaultPath()
  if (!(await credentialFileExists(path))) {
    return
  }
  if (!(await createEncryptedAntigravityAccountStore(path).read()).selectedAccountId) {
    return
  }
  const env = args.envIsComplete ? { ...args.env } : { ...process.env, ...args.env }
  for (const key of args.envToDelete ?? []) {
    delete env[key]
  }
  const hostHome = getAppEnvironment().getPath('home')
  const home = env.ORCA_ACCOUNT_HOME ?? env.HOME ?? env.USERPROFILE
  // Fork: isolated worker/chat homes and explicit agy auth overrides carry their own credentials (FORK.md §2, §8).
  const usesIsolatedCredentialAuthority =
    Boolean(
      env.ORCA_ACCOUNT_HOME ||
      env.ORCA_DELEGATION_WORKER === '1' ||
      env.GEMINI_HOME ||
      env.AGY_ACCOUNT ||
      env.AGY_ADC_AUTH ||
      env.GEMINI_API_KEY ||
      env.AGY_LLM_GATEWAY_API_KEY ||
      env.AGY_LLM_GATEWAY_URL
    ) ||
    Boolean(home && resolve(home) !== resolve(hostHome)) ||
    isAntigravityFileStorageHost(env) !== isAntigravityFileStorageHost(process.env)
  if (usesIsolatedCredentialAuthority) {
    return
  }
  await (await getAntigravityAccountService({ runtime: 'host' })).prepareForLaunch()
}
