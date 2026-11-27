import { AgentStatusQueryIndex, providerSessionIndexKey } from './agent-status-query-index'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session/lifecycle/agent-session-resume'

import type { AgentStatusIpcPayload } from '../../../shared/agent-status/contracts/agent-status-ipc-payload'

import { AgentHookServerState } from './server-state'

export abstract class AgentHookServerStatusQueries extends AgentHookServerState {
  abstract getStatusSnapshot(): AgentStatusIpcPayload[]
  abstract getStatusSnapshotForPane(paneKey: string): AgentStatusIpcPayload[]

  protected statusQueryIndex: AgentStatusQueryIndex | null = null

  protected clearRuntimeStatusQueries(): void {
    this.runtimeObservedStatusPaneKeys.clear()
    this.paneKeyByTerminalHandle.clear()
    this.statusQueryIndex = null
  }

  private queryIndex(): AgentStatusQueryIndex {
    if (!this.statusQueryIndex) {
      this.statusQueryIndex = new AgentStatusQueryIndex()
      const byPane = new Map<string, AgentStatusIpcPayload[]>()
      for (const row of this.getStatusSnapshot()) {
        const rows = byPane.get(row.paneKey) ?? []
        rows.push(row)
        byPane.set(row.paneKey, rows)
      }
      for (const [paneKey, rows] of byPane) {
        this.statusQueryIndex.update(paneKey, rows)
      }
    }
    return this.statusQueryIndex
  }

  protected updateStatusQueryIndex(paneKey: string): void {
    this.statusQueryIndex?.update(paneKey, this.getStatusSnapshotForPane(paneKey))
  }

  getProviderSessionSourceRowsForTab(tabId: string): AgentStatusIpcPayload[] {
    return Array.from(this.queryIndex().byTab.get(tabId) ?? []).flatMap((key) =>
      this.getStatusSnapshotForPane(key)
    )
  }

  getProviderSessionSourceRowsForSessionId(sessionId: string): AgentStatusIpcPayload[] {
    return Array.from(this.queryIndex().bySessionId.get(sessionId) ?? []).flatMap((key) =>
      this.getStatusSnapshotForPane(key)
    )
  }

  getProviderSessionSourceRowsForSession(
    agent: string,
    session: AgentProviderSessionMetadata
  ): AgentStatusIpcPayload[] {
    return Array.from(
      this.queryIndex().bySession.get(providerSessionIndexKey(agent, session)) ?? []
    ).flatMap((key) => this.getStatusSnapshotForPane(key))
  }

  /** Fork: live local pane shell & process context for the Background Tasks panel (FORK.md §13). */
  readPaneBackgroundShellContexts(): {
    paneKey: string
    worktreeId: string | null
    agentType: string | null
    providerSessionId: string | null
    agentPid: number | null
    runningCommands: readonly string[]
  }[] {
    const results: {
      paneKey: string
      worktreeId: string | null
      agentType: string | null
      providerSessionId: string | null
      agentPid: number | null
      runningCommands: readonly string[]
    }[] = []
    const visited = new Set<string>()
    for (const [paneKey, row] of this.state.lastStatusByPaneKey) {
      if (row.connectionId !== null || row.providerSessionOnly === true) {
        continue
      }
      visited.add(paneKey)
      const claudeCmds = this.state.claudeRunningNonAgentTasksByPaneKey.get(paneKey)
      const commands = claudeCmds ?? row.payload.backgroundCommands ?? []
      const pid =
        row.agentPresence?.ended === true ? null : (row.agentPresence?.process?.pid ?? null)
      results.push({
        paneKey,
        worktreeId: row.worktreeId ?? null,
        agentType: row.payload.agentType ?? null,
        providerSessionId: row.providerSession?.id ?? null,
        agentPid: typeof pid === 'number' && Number.isFinite(pid) && pid > 0 ? pid : null,
        runningCommands: commands
      })
    }
    for (const [paneKey, subjects] of this.canonicalSubjectsByPane) {
      if (visited.has(paneKey)) {
        continue
      }
      for (const [, subject] of subjects) {
        const status = this.canonicalStatusStore.getParent(subject)?.status
        if (!status || status.connectionId !== null) {
          continue
        }
        results.push({
          paneKey,
          worktreeId: status.worktreeId ?? null,
          agentType: status.agentType ?? null,
          providerSessionId: status.providerSession?.id ?? null,
          agentPid: null,
          runningCommands: status.backgroundCommands ?? []
        })
      }
    }
    return results
  }
}
