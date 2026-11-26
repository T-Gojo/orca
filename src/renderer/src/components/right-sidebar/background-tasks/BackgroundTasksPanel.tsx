import React, { useMemo, useState } from 'react'
import { ListTodo, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatAgentTypeLabel } from '../../../../../shared/agent-status/presentation/agent-type-label'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import { formatDurationCompact } from './background-task-eta'
import { useBackgroundTasksFeed } from './use-background-tasks-feed'
import { EcosystemHubPanel } from '../ecosystem/EcosystemHubPanel'

/** Fork: cross-agent Background Tasks + Unified Ecosystem Hub right-sidebar panel (FORK.md §13 & §16). */

type PanelSurface = 'tasks' | 'ecosystem'
type StatusFilter = 'active' | 'all'

const PRIMARY_AGENTS = [
  'claude',
  'kiro',
  'codex',
  'antigravity',
  'mistral-vibe',
  'opencode'
] as const

export default function BackgroundTasksPanel({
  isVisible
}: {
  isVisible: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const [surface, setSurface] = useState<PanelSurface>('tasks')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const { items, isRefreshing, stoppingDispatchIds, nowMs, refresh, stopWorker } =
    useBackgroundTasksFeed(isVisible)

  const summary = useMemo(() => {
    let runningCount = 0
    let waitingCount = 0
    let maxRemainingMs: number | null = null
    for (const item of items) {
      if (item.state === 'working') {
        runningCount += 1
        if (item.eta.kind === 'countdown' && item.eta.remainingMs !== null) {
          maxRemainingMs =
            maxRemainingMs === null
              ? item.eta.remainingMs
              : Math.max(maxRemainingMs, item.eta.remainingMs)
        }
      } else if (item.state === 'blocked' || item.state === 'waiting') {
        waitingCount += 1
      }
    }
    return { runningCount, waitingCount, maxRemainingMs }
  }, [items])

  const agentOptions = useMemo(() => {
    const presentAgents = new Set<string>()
    for (const item of items) {
      if (item.normalizedAgent) {
        presentAgents.add(item.normalizedAgent)
      }
    }
    const ordered: string[] = []
    for (const agent of PRIMARY_AGENTS) {
      if (presentAgents.has(agent)) {
        ordered.push(agent)
      }
    }
    for (const agent of presentAgents) {
      if (!ordered.includes(agent)) {
        ordered.push(agent)
      }
    }
    return ordered
  }, [items])

  const effectiveAgentFilter =
    agentFilter === 'all' || agentOptions.includes(agentFilter) ? agentFilter : 'all'

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (statusFilter === 'active' && !item.isActive) {
          return false
        }
        if (effectiveAgentFilter !== 'all' && item.normalizedAgent !== effectiveAgentFilter) {
          return false
        }
        return true
      }),
    [items, statusFilter, effectiveAgentFilter]
  )

  const summaryParts: string[] = []
  if (summary.runningCount > 0) {
    summaryParts.push(
      t('rightSidebar.backgroundTasks.summaryRunning', '{{count}} running', {
        count: summary.runningCount
      })
    )
  }
  if (summary.waitingCount > 0) {
    summaryParts.push(
      t('rightSidebar.backgroundTasks.summaryWaiting', '{{count}} waiting', {
        count: summary.waitingCount
      })
    )
  }
  if (summary.maxRemainingMs !== null) {
    summaryParts.push(
      t('rightSidebar.backgroundTasks.summaryEstToClear', 'Est. ~{{duration}} to clear', {
        duration: formatDurationCompact(summary.maxRemainingMs)
      })
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant={surface === 'tasks' ? 'secondary' : 'ghost-muted'}
            size="xs"
            onClick={() => setSurface('tasks')}
          >
            {t('rightSidebar.backgroundTasks.headerTitle', 'Background Tasks')}
          </Button>
          <Button
            type="button"
            variant={surface === 'ecosystem' ? 'secondary' : 'ghost-muted'}
            size="xs"
            onClick={() => setSurface('ecosystem')}
          >
            {t('rightSidebar.ecosystem.tabLabel', 'Ecosystem')}
          </Button>
          {summary.runningCount + summary.waitingCount > 0 ? (
            <Badge variant="secondary">{summary.runningCount + summary.waitingCount}</Badge>
          ) : null}
        </div>
        {surface === 'tasks' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                disabled={isRefreshing}
                aria-label={t('rightSidebar.backgroundTasks.refresh', 'Refresh background tasks')}
                onClick={refresh}
              >
                <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {t('rightSidebar.backgroundTasks.refresh', 'Refresh background tasks')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {surface === 'ecosystem' ? (
        <EcosystemHubPanel isVisible={isVisible && surface === 'ecosystem'} />
      ) : (
        <>
          {summaryParts.length > 0 ? (
            <div className="shrink-0 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground tabular-nums">
              {summaryParts.join(' · ')}
            </div>
          ) : null}

          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/40 px-3 py-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={statusFilter === 'active' ? 'secondary' : 'ghost-muted'}
                size="xs"
                onClick={() => setStatusFilter('active')}
              >
                {t('rightSidebar.backgroundTasks.filterActive', 'Active')}
              </Button>
              <Button
                type="button"
                variant={statusFilter === 'all' ? 'secondary' : 'ghost-muted'}
                size="xs"
                onClick={() => setStatusFilter('all')}
              >
                {t('rightSidebar.backgroundTasks.filterAll', 'All')}
              </Button>
            </div>

            {agentOptions.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant={effectiveAgentFilter === 'all' ? 'secondary' : 'ghost-muted'}
                  size="xs"
                  onClick={() => setAgentFilter('all')}
                >
                  {t('rightSidebar.backgroundTasks.filterAgentAll', 'All agents')}
                </Button>
                {agentOptions.map((agent) => (
                  <Button
                    key={agent}
                    type="button"
                    variant={effectiveAgentFilter === agent ? 'secondary' : 'ghost-muted'}
                    size="xs"
                    onClick={() => setAgentFilter(agent)}
                  >
                    {formatAgentTypeLabel(agent)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {filteredItems.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <ListTodo size={24} className="mb-2 text-muted-foreground/50" />
                <p className="text-xs font-medium text-foreground/80">
                  {items.length === 0
                    ? t(
                        'rightSidebar.backgroundTasks.emptyActiveTitle',
                        'No background tasks running'
                      )
                    : t(
                        'rightSidebar.backgroundTasks.emptyFilteredTitle',
                        'No matching background tasks'
                      )}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {items.length === 0
                    ? t(
                        'rightSidebar.backgroundTasks.emptyActiveSubtitle',
                        'Active agents and delegated workers across every CLI appear here with estimated ETAs.'
                      )
                    : t(
                        'rightSidebar.backgroundTasks.emptyFilteredSubtitle',
                        'Try switching filters or showing completed tasks.'
                      )}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <BackgroundTaskCard
                    key={item.id}
                    item={item}
                    nowMs={nowMs}
                    isStopping={
                      item.dispatchId !== null && stoppingDispatchIds.has(item.dispatchId)
                    }
                    onStop={stopWorker}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
