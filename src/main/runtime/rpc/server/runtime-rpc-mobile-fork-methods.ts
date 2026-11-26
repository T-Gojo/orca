// Fork: mobile allowlists for full orchestration control, background tasks, usage windows,
// and multi-provider accounts (FORK.md §15).

export const MOBILE_FORK_EXECUTION_HOST_METHODS = [
  'orchestration.workerDockStop',
  'orchestration.workerDockAcknowledge',
  'orchestration.workerDockResult',
  'orchestration.workerStop',
  'orchestration.workerList',
  'orchestration.runList',
  'orchestration.runShow',
  'orchestration.taskList',
  'orchestration.taskCreate',
  'orchestration.taskUpdate',
  'orchestration.send'
] as const

export const MOBILE_FORK_PAIRED_DESKTOP_METHODS = [
  'delegation.usage',
  'delegation.route',
  'delegation.preferences',
  'delegation.backgroundTasks',
  'delegation.usageWindows',
  'delegation.ecosystemStatus',
  'delegation.ecosystemControl',
  'delegation.ecosystemAsk',
  'delegation.ecosystemLearn',
  'accounts.kiroList',
  'accounts.kiroSelect',
  'accounts.antigravityList',
  'accounts.antigravitySelect',
  'accounts.mistralList',
  'accounts.listData'
] as const
