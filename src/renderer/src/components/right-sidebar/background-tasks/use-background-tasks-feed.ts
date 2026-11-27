import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackgroundTasksSnapshot } from '../../../../../shared/delegation/background-tasks-types'
import { formatAgentTypeLabel } from '../../../../../shared/agent-status/presentation/agent-type-label'
import { useAllAgentPaneThreads } from '@/components/activity/threads/use-agent-pane-threads'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { stopOrchestrationWorker } from '@/lib/stop-orchestration-worker'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { useNow } from '@/lib/window-activity/use-now'
import { useAppStore } from '@/store/index'
import {
  filterBackgroundTasksByScope,
  mergeBackgroundTasks,
  type BackgroundTaskItem,
  type BackgroundTasksScope
} from './background-task-merge'
import { selectActiveSessionThread } from './background-task-scope'

/** Fork: feeds the session-scoped Background Tasks panel with live shells, subagents, and child workers (FORK.md §13). */

const EMPTY_SNAPSHOT: BackgroundTasksSnapshot = {
  shells: [],
  workers: [],
  priorsByAgent: {},
  globalPrior: null,
  fetchedAt: 0
}

const RECENT_MINUTES = 60
const ACTIVE_CHANGE_THROTTLE_MS = 3_500
const VISIBLE_POLL_INTERVAL_MS = 4_000
const CLOCK_TICK_MS = 1_000

export type BackgroundTasksFeed = {
  items: BackgroundTaskItem[]
  allBackgroundCount: number
  workspaceBackgroundCount: number
  sessionBackgroundCount: number
  scope: BackgroundTasksScope
  setScope: (scope: BackgroundTasksScope) => void
  activeSessionLabel: string | null
  isRefreshing: boolean
  stoppingDispatchIds: ReadonlySet<string>
  nowMs: number
  refresh: () => void
  stopWorker: (dispatchId: string) => void
}

export function useBackgroundTasksFeed(isVisible: boolean): BackgroundTasksFeed {
  const { allThreads, storeData } = useAllAgentPaneThreads({ badgeOnly: false })
  const currentWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const currentTabId = useAppStore((s) => s.activeTabId)
  const currentLeafId = useAppStore((s) =>
    s.activeTabId ? (s.terminalLayoutsByTabId[s.activeTabId]?.activeLeafId ?? null) : null
  )

  const [scope, setScope] = useState<BackgroundTasksScope>('session')
  const [snapshot, setSnapshot] = useState<BackgroundTasksSnapshot>(EMPTY_SNAPSHOT)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stoppingDispatchIds, setStoppingDispatchIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const lastFetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  const activeSession = useMemo(
    () => selectActiveSessionThread(allThreads, currentWorktreeId, currentTabId, currentLeafId),
    [allThreads, currentWorktreeId, currentTabId, currentLeafId]
  )
  const activeSessionPaneKey = activeSession?.paneKey ?? null
  const activeSessionEntry = activeSession?.currentAgentEntry ?? activeSession?.paneEntry
  const activeSessionRunId = activeSessionEntry?.orchestration?.orchestrationRunId ?? null

  const activeSessionLabel = useMemo(() => {
    if (!activeSession) {
      return null
    }
    const agent = formatAgentTypeLabel(activeSession.agentType)
    const ws = activeSession.worktree.displayName || activeSession.worktree.branch
    const repo = activeSession.repo?.displayName
    const place = repo && ws && repo !== ws ? `${repo} / ${ws}` : (ws ?? repo)
    return [agent, place].filter(Boolean).join(' · ')
  }, [activeSession])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchSnapshot = useCallback(
    (force: boolean) => {
      if (inFlightRef.current) {
        return
      }
      const now = Date.now()
      if (!force && now - lastFetchedAtRef.current < ACTIVE_CHANGE_THROTTLE_MS) {
        return
      }
      inFlightRef.current = true
      setIsRefreshing(true)
      callRuntimeRpc<BackgroundTasksSnapshot>(
        { kind: 'local' },
        'delegation.backgroundTasks',
        {
          recentMinutes: RECENT_MINUTES,
          ...(activeSessionPaneKey ? { paneKey: activeSessionPaneKey } : {}),
          ...(currentWorktreeId ? { worktreeId: currentWorktreeId } : {})
        },
        { background: !force, timeoutMs: 10_000 }
      )
        .then((result) => {
          if (!mountedRef.current) {
            return
          }
          lastFetchedAtRef.current = Date.now()
          setSnapshot(result)
        })
        .catch(() => {})
        .then(() => {
          inFlightRef.current = false
          if (mountedRef.current) {
            setIsRefreshing(false)
          }
        })
    },
    [activeSessionPaneKey, currentWorktreeId]
  )

  useEffect(() => {
    if (!isVisible) {
      return
    }
    fetchSnapshot(true)
    return installWindowVisibilityInterval({
      run: () => fetchSnapshot(false),
      intervalMs: VISIBLE_POLL_INTERVAL_MS
    })
  }, [isVisible, fetchSnapshot])

  const { worktreeNameById, repoNameByWorktreeId, paneKeysInActiveWorktree } = useMemo(() => {
    const wtNames = new Map<string, string>()
    const repoNames = new Map<string, string>()
    const paneKeys = new Set<string>()
    for (const [id, wt] of storeData.worktreeMap) {
      wtNames.set(id, wt.displayName || wt.branch)
      const repo = storeData.repoMap.get(wt.repoId)
      if (repo?.displayName) {
        repoNames.set(id, repo.displayName)
      }
    }
    if (currentWorktreeId) {
      for (const thread of allThreads) {
        if (thread.worktree.id === currentWorktreeId) {
          paneKeys.add(thread.paneKey)
        }
      }
    }
    return {
      worktreeNameById: wtNames,
      repoNameByWorktreeId: repoNames,
      paneKeysInActiveWorktree: paneKeys
    }
  }, [storeData.worktreeMap, storeData.repoMap, allThreads, currentWorktreeId])

  const hasActiveTasks = useMemo(
    () =>
      snapshot.shells.some((shell) => shell.state === 'running') ||
      snapshot.workers.some(
        (w) =>
          w.dispatchStatus === 'pending' ||
          w.dispatchStatus === 'dispatched' ||
          w.state === 'starting' ||
          w.state === 'ready'
      ) ||
      allThreads.some((t) => (t.currentAgentEntry ?? t.paneEntry)?.workingMode === 'monitoring'),
    [snapshot.shells, snapshot.workers, allThreads]
  )

  const nowMs = useNow(CLOCK_TICK_MS, isVisible && hasActiveTasks)

  const mergedItems = useMemo(
    () =>
      mergeBackgroundTasks({
        shells: snapshot.shells,
        threads: allThreads,
        workers: snapshot.workers,
        priorsByAgent: snapshot.priorsByAgent,
        globalPrior: snapshot.globalPrior,
        worktreeNameById,
        repoNameByWorktreeId,
        nowMs
      }),
    [
      snapshot.shells,
      allThreads,
      snapshot.workers,
      snapshot.priorsByAgent,
      snapshot.globalPrior,
      worktreeNameById,
      repoNameByWorktreeId,
      nowMs
    ]
  )

  const scopeCtx = useMemo(
    () => ({
      activeSessionPaneKey,
      activeSessionRunId,
      activeWorktreeId: currentWorktreeId,
      paneKeysInActiveWorktree
    }),
    [activeSessionPaneKey, activeSessionRunId, currentWorktreeId, paneKeysInActiveWorktree]
  )

  const sessionItems = useMemo(
    () => filterBackgroundTasksByScope(mergedItems, { ...scopeCtx, scope: 'session' }),
    [mergedItems, scopeCtx]
  )
  const workspaceItems = useMemo(
    () => filterBackgroundTasksByScope(mergedItems, { ...scopeCtx, scope: 'workspace' }),
    [mergedItems, scopeCtx]
  )
  const items =
    scope === 'session' ? sessionItems : scope === 'workspace' ? workspaceItems : mergedItems

  const stopWorker = useCallback(
    (dispatchId: string) => {
      setStoppingDispatchIds((prev) => new Set(prev).add(dispatchId))
      stopOrchestrationWorker(dispatchId)
        .catch(() => {})
        .then(() => {
          if (!mountedRef.current) {
            return
          }
          setStoppingDispatchIds((prev) => {
            const next = new Set(prev)
            next.delete(dispatchId)
            return next
          })
          fetchSnapshot(true)
        })
    },
    [fetchSnapshot]
  )

  return {
    items,
    allBackgroundCount: mergedItems.filter((item) => item.isActive).length,
    workspaceBackgroundCount: workspaceItems.filter((item) => item.isActive).length,
    sessionBackgroundCount: sessionItems.filter((item) => item.isActive).length,
    scope,
    setScope,
    activeSessionLabel,
    isRefreshing,
    stoppingDispatchIds,
    nowMs,
    refresh: useCallback(() => fetchSnapshot(true), [fetchSnapshot]),
    stopWorker
  }
}
