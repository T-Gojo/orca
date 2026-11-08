import { useCallback } from 'react'
import { useAppStore } from '../../../store'
import { buildPaneAccountRestartStartup } from '@/lib/agent-account-restart-startup'
import type { TerminalPaneCloseController } from '../layout/close/use-terminal-pane-close-actions'
import type { AccountRestartAgent } from '@/store/terminals/terminal-contracts'

export function usePaneAccountRestartStartup({
  tabId,
  worktreeId
}: Pick<TerminalPaneCloseController, 'tabId' | 'worktreeId'>) {
  const buildAccountRestartStartup = useCallback(
    (agent: AccountRestartAgent, leafId: string, ptyId: string) =>
      buildPaneAccountRestartStartup(agent, {
        ptyId,
        tabId,
        worktreeId,
        leafId,
        shellOverride: useAppStore
          .getState()
          .tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.shellOverride
      }),
    [tabId, worktreeId]
  )
  return { buildAccountRestartStartup }
}
