import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { isTerminalLeafId, makePaneKey } from '../../../shared/stable-pane-id'
import { normalizeAgentProviderSession } from '../../../shared/agent-session-resume'
import type { AccountRestartAgent } from '@/store/terminals/terminal-contracts'
import { resolveAgentAccountRestartResumeStartup } from './agent-account-restart-startup'
import {
  markAgentTerminalTabAccountPinned,
  setPaneRestartAccount
} from './agent-terminal-account-pins'
import { isForeignMachineCodexPtyId } from './codex-pane-selection-lane'
import { resolveClaudeSessionAccountId } from './claude-session-account-move'

export type TabAgentAccountPane = {
  agent: AccountRestartAgent
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string
  /** The account the running session reports; undefined when it cannot tell. */
  currentAccountId: string | null | undefined
}

/** The tab's local Claude or Codex terminal session, if one is running. */
export function resolveTabAgentAccountPane(
  state: AppState,
  tab: { id: string; worktreeId: string }
): TabAgentAccountPane | null {
  const boundPtyIds = state.ptyIdsByTabId?.[tab.id] ?? []
  const leaves = state.terminalLayoutsByTabId?.[tab.id]?.ptyIdsByLeafId ?? {}
  for (const [leafId, ptyId] of Object.entries(leaves)) {
    if (
      !ptyId ||
      !isTerminalLeafId(leafId) ||
      !boundPtyIds.includes(ptyId) ||
      isForeignMachineCodexPtyId(ptyId)
    ) {
      continue
    }
    const entry = state.agentStatusByPaneKey?.[makePaneKey(tab.id, leafId)]
    const agent: AccountRestartAgent | null =
      entry?.agentType === 'claude' ? 'claude' : entry?.agentType === 'codex' ? 'codex' : null
    if (!agent || entry?.structuredHostOwned) {
      continue
    }
    return {
      agent,
      worktreeId: tab.worktreeId,
      tabId: tab.id,
      leafId,
      ptyId,
      currentAccountId:
        agent === 'claude'
          ? resolveClaudeSessionAccountId(
              normalizeAgentProviderSession(entry.providerSession)?.transcriptPath,
              state.settings?.claudeManagedAccounts ?? []
            )
          : undefined
    }
  }
  return null
}

/** Restarts the pane's agent on `accountId`, resuming the same conversation. */
export function restartTabAgentOnAccount(
  pane: TabAgentAccountPane,
  accountId: string | null,
  accountLabel: string
): void {
  const resumable = resolveAgentAccountRestartResumeStartup(pane.agent, {
    tabId: pane.tabId,
    leafId: pane.leafId,
    worktreeId: pane.worktreeId
  })
  // Why: a Claude restart only ever resumes; without a session id it would start a blank chat.
  if (!resumable && pane.agent === 'claude') {
    toast.error(
      translate(
        'auto.lib.tabAgentAccountSwitch.notResumable',
        'This Claude session cannot be resumed yet. Send it a message first, then try again.'
      )
    )
    return
  }
  setPaneRestartAccount(pane.ptyId, accountId)
  markAgentTerminalTabAccountPinned(pane.tabId)
  useAppStore.getState().queuePaneAccountRestarts([pane.ptyId], pane.agent)
  toast(
    translate('auto.lib.tabAgentAccountSwitch.restarting', 'Restarting on {{value0}}', {
      value0: accountLabel
    }),
    {
      description:
        pane.agent === 'claude'
          ? translate(
              'auto.lib.tabAgentAccountSwitch.claudeWaits',
              'Claude restarts once its current turn ends, then resumes this conversation.'
            )
          : undefined
    }
  )
}
