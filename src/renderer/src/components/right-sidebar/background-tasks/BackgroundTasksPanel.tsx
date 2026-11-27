import React, { useMemo, useState } from 'react'
import { ListTodo, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import { formatDurationCompact } from './background-task-eta'
import { useBackgroundTasksFeed } from './use-background-tasks-feed'
import { EcosystemHubPanel } from '../ecosystem/EcosystemHubPanel'

/** Fork: session-scoped Background Tasks + Unified Ecosystem Hub right-sidebar panel (FORK.md §13 & §16). */

type PanelSurface = 'tasks' | 'ecosystem'
type StatusFilter = 'active' | 'all'

export default function BackgroundTasksPanel({
  isVisible
}: {
  isVisible: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const [surface, setSurface] = useState<PanelSurface>('tasks')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const {
    items,
    allBackgroundCount,
    workspaceBackgroundCount,
    sessionBackgroundCount,
    scope,
    setScope,
    activeSessionLabel,
    isRefreshing,
    stoppingDispatchIds,
    nowMs,
    refresh,
    stopWorker
  } = useBackgroundTasksFeed(isVisible)

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

  const filteredItems = useMemo(
    () => items.filter((item) => (statusFilter === 'active' ? item.isActive : true)),
    [items, statusFilter]
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
      t('rightSidebar.backgroundTasks.summaryEstToClear', 'Est. ~{{duration}} left', {
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
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/40 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant={scope === 'session' ? 'secondary' : 'ghost-muted'}
                  size="xs"
                  onClick={() => setScope('session')}
                >
                  {t('rightSidebar.backgroundTasks.scopeSession', 'This session')}
                  {sessionBackgroundCount > 0 ? ` (${sessionBackgroundCount})` : ''}
                </Button>
                <Button
                  type="button"
                  variant={scope === 'workspace' ? 'secondary' : 'ghost-muted'}
                  size="xs"
                  onClick={() => setScope('workspace')}
                >
                  {t('rightSidebar.backgroundTasks.scopeWorkspace', 'Workspace')}
                  {workspaceBackgroundCount > 0 ? ` (${workspaceBackgroundCount})` : ''}
                </Button>
                <Button
                  type="button"
                  variant={scope === 'all' ? 'secondary' : 'ghost-muted'}
                  size="xs"
                  onClick={() => setScope('all')}
                >
                  {t('rightSidebar.backgroundTasks.scopeAll', 'All')}
                  {allBackgroundCount > 0 ? ` (${allBackgroundCount})` : ''}
                </Button>
              </div>

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
                  {t('rightSidebar.backgroundTasks.filterRecent', 'Recent')}
                </Button>
              </div>
            </div>

            {scope === 'session' && activeSessionLabel ? (
              <div className="truncate text-2xs text-muted-foreground">{activeSessionLabel}</div>
            ) : null}
          </div>

          {summaryParts.length > 0 ? (
            <div className="shrink-0 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground tabular-nums">
              {summaryParts.join(' · ')}
            </div>
          ) : null}

          <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {filteredItems.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <ListTodo size={24} className="mb-2 text-muted-foreground/50" />
                <p className="text-xs font-medium text-foreground/80">
                  {items.length === 0
                    ? scope === 'session'
                      ? t(
                          'rightSidebar.backgroundTasks.emptySessionTitle',
                          'No background tasks in this session'
                        )
                      : t(
                          'rightSidebar.backgroundTasks.emptyActiveTitle',
                          'No background tasks running'
                        )
                    : t(
                        'rightSidebar.backgroundTasks.emptyFilteredTitle',
                        'No active background tasks'
                      )}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {items.length === 0
                    ? t(
                        'rightSidebar.backgroundTasks.emptySessionSubtitle',
                        'Background shells (such as builds or watchers), subagents, and delegated workers from this session appear here with live progress and estimated ETAs.'
                      )
                    : t(
                        'rightSidebar.backgroundTasks.emptyFilteredSubtitle',
                        'Switch to Recent to view completed background tasks.'
                      )}
                </p>
                {scope === 'session' && allBackgroundCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="xs"
                    className="mt-2"
                    onClick={() => setScope('all')}
                  >
                    {t(
                      'rightSidebar.backgroundTasks.viewOtherSessions',
                      'Show {{count}} running in other sessions',
                      { count: allBackgroundCount }
                    )}
                  </Button>
                ) : null}
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
