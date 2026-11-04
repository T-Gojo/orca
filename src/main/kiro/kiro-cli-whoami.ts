import { runProcess } from '@orca/process-host'
import { resolveCommandOnLocalPath } from '../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../runtime/structured-agent-shell-environment'

const WHOAMI_TIMEOUT_MS = 15_000

/** The email kiro-cli reports for its current login; Builder ID logins get none from the usage API. */
export async function readKiroCliWhoamiEmail(): Promise<string | null> {
  try {
    // Why the login-shell env: kiro-cli lives on the user's PATH, not Electron's.
    const env = await hostShellEnvironment()
    const program = await resolveCommandOnLocalPath('kiro-cli', { platform: process.platform, env })
    if (!program) {
      return null
    }
    const result = await runProcess({
      program,
      args: ['whoami', '--format', 'json'],
      env,
      timeoutMs: WHOAMI_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024
    })
    if (result.code !== 0) {
      return null
    }
    const value: unknown = JSON.parse(result.stdout)
    const email =
      typeof value === 'object' && value !== null && 'email' in value ? value.email : null
    return typeof email === 'string' && email.includes('@') ? email : null
  } catch {
    return null
  }
}
