import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackgroundTasksSnapshot } from '../../../../../shared/delegation/background-tasks-types'
import { useAllAgentPaneThreads } from '@/components/activity/threads/use-agent-pane-threads'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { stopOrchestrationWorker } from '@/lib/stop-orchestration-worker'
import { useNow } from '@/lib/window-activity/use-now'
import { mergeBackgroundTasks, type BackgroundTaskItem } from './background-task-merge'

/** Fork: feeds the Background Tasks sidebar panel with live threads + durable orchestration workers (FORK.md §13). */

const EMPTY_SNAPSHOT: BackgroundTasksSnapshot = {
  workers: [],
  priorsByAgent: {},
  globalPrior: null,
  fetchedAt: 0
}

const RECENT_MINUTES = 60
const ACTIVE_CHANGE_THROTTLE_MS = 8_000
const CLOCK_TICK_MS = 1_000

export type BackgroundTasksFeed = {
  items: BackgroundTaskItem[]
  isRefreshing: boolean
  stoppingDispatchIds: ReadonlySet<string>
  nowMs: number
  refresh: () => void
  stopWorker: (dispatchId: string) => void
}

export function useBackgroundTasksFeed(isVisible: boolean): BackgroundTasksFeed {
  const { allThreads, storeData } = useAllAgentPaneThreads({ badgeOnly: false })
  const [snapshot, setSnapshot] = useState<BackgroundTasksSnapshot>(EMPTY_SNAPSHOT)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stoppingDispatchIds, setStoppingDispatchIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const lastFetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchSnapshot = useCallback((force: boolean) => {
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
      { recentMinutes: RECENT_MINUTES },
      { background: !force, timeoutMs: 10_000 }
    )
      .then((result) => {
        if (!mountedRef.current) {
          return
        }
        lastFetchedAtRef.current = Date.now()
        setSnapshot(result)
      })
      .catch(() => {
        // Keep the last snapshot + live agent threads when the orchestration RPC is unavailable.
      })
      .then(() => {
        inFlightRef.current = false
        if (mountedRef.current) {
          setIsRefreshing(false)
        }
      })
  }, [])

  useEffect(() => {
    if (isVisible) {
      fetchSnapshot(true)
    }
  }, [isVisible, fetchSnapshot])

  const activeThreadSignature = useMemo(() => {
    const parts: string[] = []
    for (const thread of allThreads) {
      if (thread.currentAgentState) {
        parts.push(`${thread.paneKey}:${thread.currentAgentState}`)
      }
    }
    parts.sort()
    return parts.join('|')
  }, [allThreads])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    fetchSnapshot(false)
  }, [isVisible, activeThreadSignature, fetchSnapshot])

  const hasActiveTasks = useMemo(() => {
    if (allThreads.some((thread) => thread.currentAgentState !== null)) {
      return true
    }
    return snapshot.workers.some(
      (worker) =>
        worker.dispatchStatus === 'pending' ||
        worker.dispatchStatus === 'dispatched' ||
        worker.state === 'starting' ||
        worker.state === 'ready'
    )
  }, [allThreads, snapshot.workers])

  const nowMs = useNow(CLOCK_TICK_MS, isVisible && hasActiveTasks)

  const { worktreeNameById, repoNameByWorktreeId } = useMemo(() => {
    const wtNames = new Map<string, string>()
    const repoNames = new Map<string, string>()
    for (const [id, wt] of storeData.worktreeMap) {
      wtNames.set(id, wt.displayName || wt.branch)
      const repo = storeData.repoMap.get(wt.repoId)
      if (repo?.displayName) {
        repoNames.set(id, repo.displayName)
      }
    }
    return { worktreeNameById: wtNames, repoNameByWorktreeId: repoNames }
  }, [storeData.worktreeMap, storeData.repoMap])

  const items = useMemo(
    () =>
      mergeBackgroundTasks({
        threads: allThreads,
        workers: snapshot.workers,
        priorsByAgent: snapshot.priorsByAgent,
        globalPrior: snapshot.globalPrior,
        worktreeNameById,
        repoNameByWorktreeId,
        nowMs
      }),
    [
      allThreads,
      snapshot.workers,
      snapshot.priorsByAgent,
      snapshot.globalPrior,
      worktreeNameById,
      repoNameByWorktreeId,
      nowMs
    ]
  )

  const refresh = useCallback(() => {
    fetchSnapshot(true)
  }, [fetchSnapshot])

  const stopWorker = useCallback(
    (dispatchId: string) => {
      setStoppingDispatchIds((prev) => {
        const next = new Set(prev)
        next.add(dispatchId)
        return next
      })
      stopOrchestrationWorker(dispatchId)
        .catch(() => {
          // stopOrchestrationWorker already reports errors via toast.
        })
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
    isRefreshing,
    stoppingDispatchIds,
    nowMs,
    refresh,
    stopWorker
  }
}
