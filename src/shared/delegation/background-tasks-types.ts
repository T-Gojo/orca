/** Fork: session-scoped background shell, subagent, and worker snapshot types (FORK.md §13). */

export type BackgroundTaskShellProgress = {
  completedSteps: number | null
  totalSteps: number | null
  percent: number
  label: string
}

export type BackgroundTaskShellRecord = {
  id: string
  paneKey: string
  worktreeId: string | null
  agent: string | null
  command: string
  outputTail: string | null
  progress: BackgroundTaskShellProgress | null
  pid: number | null
  cpuPercent: number | null
  state: 'running' | 'done' | 'failed'
  startedAt: number
  updatedAt: number
  completedAt: number | null
  exitCode: number | null
}

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
  creatorPaneKey: string | null
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
  shells: BackgroundTaskShellRecord[]
  workers: BackgroundTaskWorkerRecord[]
  priorsByAgent: Record<string, AgentDurationPrior>
  globalPrior: AgentDurationPrior | null
  fetchedAt: number
}
