import React from 'react'
import { GitFork, Square, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { AgentStateDot, type AgentDotState } from '@/components/agent/status/AgentStateDot'
import { revealDashboardAgent } from '@/components/dashboard/navigation/reveal-dashboard-agent'
import { useTranslate } from '@/i18n/use-translate'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { cn } from '@/lib/class-names'
import { formatAgentTypeLabel } from '../../../../../shared/agent-status/presentation/agent-type-label'
import type { TerminalAgent } from '../../../../../shared/agent-status/identity/terminal-agent'
import {
  formatDurationCompact,
  type BackgroundTaskEtaEstimate,
  type BackgroundTaskEtaState
} from './background-task-eta'
import type { BackgroundTaskItem } from './background-task-merge'

/** Fork: monochrome card showing a background shell, subagent, or child worker with live progress & ETA (FORK.md §13). */

type BackgroundTaskCardProps = {
  item: BackgroundTaskItem
  nowMs: number
  isStopping: boolean
  onStop: (dispatchId: string) => void
}

function toTerminalAgent(agent: string | null): TerminalAgent | null {
  if (!agent) {
    return null
  }
  if (agent === 'dsb') {
    return 'dsb'
  }
  return getAgentCatalog().find((entry) => entry.id === agent)?.id ?? null
}

function statusBadgeVariant(
  state: BackgroundTaskEtaState
): 'secondary' | 'warning' | 'destructive' | 'outline' {
  switch (state) {
    case 'working':
      return 'secondary'
    case 'blocked':
    case 'waiting':
      return 'warning'
    case 'failed':
      return 'destructive'
    case 'done':
      return 'outline'
  }
}

function toDotState(state: BackgroundTaskEtaState): AgentDotState {
  switch (state) {
    case 'working':
      return 'working'
    case 'blocked':
      return 'blocked'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'done':
      return 'done'
  }
}

function statusLabel(
  item: Pick<BackgroundTaskItem, 'kind' | 'state'>,
  t: ReturnType<typeof useTranslate>
): string {
  if (item.state === 'working' && item.kind === 'shell') {
    return t('rightSidebar.backgroundTasks.statusRunning', 'Running')
  }
  switch (item.state) {
    case 'working':
      return t('rightSidebar.backgroundTasks.statusWorking', 'Working')
    case 'blocked':
      return t('rightSidebar.backgroundTasks.statusBlocked', 'Blocked')
    case 'waiting':
      return t('rightSidebar.backgroundTasks.statusWaiting', 'Waiting')
    case 'failed':
      return t('rightSidebar.backgroundTasks.statusFailed', 'Failed')
    case 'done':
      return t('rightSidebar.backgroundTasks.statusDone', 'Done')
  }
}

function kindBadgeLabel(
  kind: BackgroundTaskItem['kind'],
  t: ReturnType<typeof useTranslate>
): string {
  switch (kind) {
    case 'shell':
      return t('rightSidebar.backgroundTasks.kindShell', 'Shell')
    case 'subagent':
      return t('rightSidebar.backgroundTasks.kindSubagent', 'Subagent')
    case 'worker':
      return t('rightSidebar.backgroundTasks.kindWorker', 'Worker')
  }
}

function etaLabel(
  eta: BackgroundTaskEtaEstimate,
  elapsedMs: number,
  t: ReturnType<typeof useTranslate>
): string {
  switch (eta.kind) {
    case 'countdown':
      return t('rightSidebar.backgroundTasks.etaCountdown', '~{{duration}} left (est.)', {
        duration: formatDurationCompact(eta.remainingMs ?? 0)
      })
    case 'overrun':
      if (eta.expectedTotalMs !== null && elapsedMs > eta.expectedTotalMs) {
        return `+${formatDurationCompact(elapsedMs - eta.expectedTotalMs)} past ~${formatDurationCompact(eta.expectedTotalMs)} (est.)`
      }
      return t('rightSidebar.backgroundTasks.etaOverrun', 'Still running (est.)')
    case 'waiting':
      return t('rightSidebar.backgroundTasks.etaWaiting', 'Waiting on input')
    case 'stalled':
      return t('rightSidebar.backgroundTasks.etaStalled', 'Stalled? (est.)')
    case 'done':
      return t('rightSidebar.backgroundTasks.etaDone', 'Completed')
    case 'unknown':
      return t('rightSidebar.backgroundTasks.etaUnknown', 'Estimating…')
  }
}

function etaBasisTooltip(
  eta: BackgroundTaskEtaEstimate,
  agentLabel: string,
  t: ReturnType<typeof useTranslate>
): string {
  switch (eta.basis) {
    case 'steps':
      return t(
        'rightSidebar.backgroundTasks.etaBasisSteps',
        'Paced from live build/command step progress'
      )
    case 'command':
      return t(
        'rightSidebar.backgroundTasks.etaBasisCommand',
        'Estimated from typical duration for this command kind'
      )
    case 'subagents':
      return t('rightSidebar.backgroundTasks.etaBasisSubagents', 'Estimated from subagent progress')
    case 'history':
      return t(
        'rightSidebar.backgroundTasks.etaBasisHistory',
        'Estimated from recent turns on this agent'
      )
    case 'prior':
      return t(
        'rightSidebar.backgroundTasks.etaBasisPrior',
        'Estimated from past {{agent}} completions',
        { agent: agentLabel }
      )
    case 'default':
      return t(
        'rightSidebar.backgroundTasks.etaBasisDefault',
        'Rough estimate from typical {{agent}} duration',
        { agent: agentLabel }
      )
  }
}

export const BackgroundTaskCard = React.memo(function BackgroundTaskCard({
  item,
  nowMs,
  isStopping,
  onStop
}: BackgroundTaskCardProps): React.JSX.Element {
  const t = useTranslate()
  const agentLabel = formatAgentTypeLabel(item.agentType)
  const displayTitle =
    item.title || t('rightSidebar.backgroundTasks.untitledTask', 'Background task')
  const elapsedEndMs = item.completedAt ?? nowMs
  const elapsedMs = Math.max(0, elapsedEndMs - item.startedAt)
  const elapsedText = t('rightSidebar.backgroundTasks.elapsed', 'Elapsed {{duration}}', {
    duration: formatDurationCompact(elapsedMs)
  })
  const etaText = etaLabel(item.eta, elapsedMs, t)
  const etaTip = etaBasisTooltip(item.eta, agentLabel, t)

  const metadataParts = [
    kindBadgeLabel(item.kind, t),
    agentLabel,
    item.repoName && item.workspaceName && item.repoName !== item.workspaceName
      ? `${item.repoName} / ${item.workspaceName}`
      : (item.workspaceName ?? item.repoName),
    item.account,
    item.cpuPercent !== null && item.cpuPercent >= 1 ? `${Math.round(item.cpuPercent)}% CPU` : null,
    item.pid !== null ? `PID ${item.pid}` : null
  ].filter((part): part is string => Boolean(part))

  const canReveal = item.revealTarget !== null
  const handleReveal = (): void => {
    if (item.revealTarget) {
      revealDashboardAgent(item.revealTarget)
    }
  }

  return (
    <div
      role={canReveal ? 'button' : undefined}
      tabIndex={canReveal ? 0 : undefined}
      onClick={canReveal ? handleReveal : undefined}
      onKeyDown={
        canReveal
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleReveal()
              }
            }
          : undefined
      }
      className={cn(
        'rounded-md border border-border/60 bg-card/30 p-2.5 transition-colors',
        canReveal &&
          'cursor-pointer hover:border-border hover:bg-card/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {item.kind === 'shell' ? (
            <Terminal size={13} />
          ) : item.kind === 'subagent' ? (
            <GitFork size={13} />
          ) : (
            <AgentIcon agent={toTerminalAgent(item.agentType)} size={14} />
          )}
          <AgentStateDot state={toDotState(item.state)} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <span className="line-clamp-2 text-xs font-medium leading-4 text-foreground">
              {displayTitle}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant={statusBadgeVariant(item.state)}>{statusLabel(item, t)}</Badge>
              {item.canStop && item.dispatchId ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost-destructive"
                      size="icon-xs"
                      disabled={isStopping}
                      aria-label={t('rightSidebar.backgroundTasks.stopWorker', 'Stop worker')}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (item.dispatchId) {
                          onStop(item.dispatchId)
                        }
                      }}
                    >
                      <Square />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {t('rightSidebar.backgroundTasks.stopWorker', 'Stop worker')}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>

          {metadataParts.length > 0 ? (
            <div className="mt-1 truncate text-2xs text-muted-foreground tabular-nums">
              {metadataParts.join(' · ')}
            </div>
          ) : null}

          {item.activityLine ? (
            <div
              className={cn(
                'mt-1 truncate font-mono text-2xs',
                item.lastError ? 'text-destructive' : 'text-muted-foreground'
              )}
              title={item.activityLine}
            >
              {item.activityLine}
            </div>
          ) : null}

          {item.outputTail && item.outputTail !== item.activityLine ? (
            <div
              className="mt-1 truncate rounded bg-muted/40 px-1.5 py-0.5 font-mono text-2xs text-foreground/80"
              title={item.outputTail}
            >
              {item.outputTail}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2 text-2xs tabular-nums">
            <span className="truncate text-muted-foreground">
              {item.progressLabel ? `${item.progressLabel} · ${elapsedText}` : elapsedText}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'shrink-0',
                    item.eta.kind === 'stalled' || item.eta.kind === 'waiting'
                      ? 'text-status-warning-text'
                      : 'text-foreground/80'
                  )}
                >
                  {etaText}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{etaTip}</TooltipContent>
            </Tooltip>
          </div>

          {item.isActive && item.eta.progressRatio !== null ? (
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(item.eta.progressRatio * 100)}
            >
              <div
                className="h-full rounded-full bg-foreground/60 transition-[width] duration-500"
                style={{ width: `${Math.round(item.eta.progressRatio * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})
