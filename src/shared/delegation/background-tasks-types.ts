/** Fork: unified background-task sidebar snapshot types (FORK.md §13). */

export type BackgroundTaskWorkerRecord = {
  dispatchId: string
  runId: string
  taskId: string | null
  taskTitle: string | null
  displayName: string | null
  objective: string | null
  agent: string | null
  model: string | null
  account: string | null
  state: string
  stage: string | null
  dispatchStatus: string
  paneKey: string | null
  worktreeId: string | null
  terminalHandle: string | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
  lastError: string | null
  messageCount: number
}

export type AgentDurationPrior = {
  agent: string
  sampleCount: number
  medianMs: number
  p75Ms: number
}

export type BackgroundTasksSnapshot = {
  workers: BackgroundTaskWorkerRecord[]
  priorsByAgent: Record<string, AgentDurationPrior>
  globalPrior: AgentDurationPrior | null
  fetchedAt: number
}
