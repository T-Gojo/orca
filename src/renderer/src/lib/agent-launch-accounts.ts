import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'

/** One account a new agent terminal can be opened on; `id: null` is the agent's own login. */
export type AgentLaunchAccount = {
  id: string | null
  label: string
  /** The account new launches use when none is picked. */
  selected: boolean
}

export type AgentLaunchAccountAgent = Extract<TuiAgent, 'claude' | 'codex'>

export type AgentLaunchAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'codexManagedAccounts'
  | 'activeCodexManagedAccountId'
  | 'activeCodexManagedAccountIdsByRuntime'
>

export function isAgentLaunchAccountAgent(agent: TuiAgent): agent is AgentLaunchAccountAgent {
  return agent === 'claude' || agent === 'codex'
}

function withDetail(email: string, detail: string | null | undefined): string {
  return detail ? `${email} · ${detail}` : email
}

/**
 * Host accounts a local terminal launch can pin, System default first. Empty when there is
 * nothing to choose between, so callers keep the plain one-click row.
 */
export function listAgentLaunchAccounts(
  agent: TuiAgent,
  settings: AgentLaunchAccountSettings | null | undefined,
  systemDefaultLabel: string
): AgentLaunchAccount[] {
  if (!settings || !isAgentLaunchAccountAgent(agent)) {
    return []
  }
  const selectedId =
    agent === 'claude'
      ? (settings.activeClaudeManagedAccountIdsByRuntime?.host ??
        settings.activeClaudeManagedAccountId ??
        null)
      : (settings.activeCodexManagedAccountIdsByRuntime?.host ??
        settings.activeCodexManagedAccountId ??
        null)
  const managed =
    agent === 'claude'
      ? (settings.claudeManagedAccounts ?? [])
          .filter((account) => account.managedAuthRuntime !== 'wsl')
          .map((account) => ({
            id: account.id,
            label: withDetail(account.email, account.organizationName)
          }))
      : (settings.codexManagedAccounts ?? [])
          .filter((account) => account.managedHomeRuntime !== 'wsl')
          .map((account) => ({
            id: account.id,
            label: withDetail(account.email, account.workspaceLabel)
          }))
  if (managed.length === 0) {
    return []
  }
  return [
    { id: null, label: systemDefaultLabel, selected: selectedId === null },
    ...managed.map((account) => ({ ...account, selected: account.id === selectedId }))
  ]
}
