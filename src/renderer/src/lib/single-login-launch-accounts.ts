import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentLaunchAccount } from './agent-launch-accounts'
import {
  switchAntigravityAccountForLaunch,
  useAntigravityLaunchAccounts
} from './antigravity-launch-accounts'
import { switchKiroAccountForLaunch, useKiroLaunchAccounts } from './kiro-launch-accounts'

export type SingleLoginLaunchAccounts = {
  accounts: AgentLaunchAccount[]
  switchTo: (accounts: AgentLaunchAccount[], accountId: string | null) => Promise<boolean>
}

/** agy and kiro-cli keep one login, so a launch picks an account by switching that login first. */
export function useSingleLoginLaunchAccounts(
  localAgents: readonly (TuiAgent | null | undefined)[]
): (agent: TuiAgent) => SingleLoginLaunchAccounts | null {
  const antigravity = useAntigravityLaunchAccounts(localAgents.includes('antigravity'))
  const kiro = useKiroLaunchAccounts(localAgents.includes('kiro'))
  return (agent) =>
    agent === 'antigravity'
      ? { accounts: antigravity, switchTo: switchAntigravityAccountForLaunch }
      : agent === 'kiro'
        ? { accounts: kiro, switchTo: switchKiroAccountForLaunch }
        : null
}
