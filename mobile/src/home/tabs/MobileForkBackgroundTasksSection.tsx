import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Square } from 'lucide-react-native'
import type {
  BackgroundTasksSnapshot,
  BackgroundTaskWorkerRecord
} from '../../../../src/shared/delegation/background-tasks-types'
import { AgentStateDot } from '../../agents/presentation/AgentStateDot'
import { MobileAgentIcon } from '../../components/icons/MobileAgentIcon'
import type { HostProfile } from '../../host-catalog/host-profile'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { triggerSelection } from '../../platform/haptics/haptics'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { ConnectionState } from '../../transport/connection/connection-state'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { runRpcOperation } from '../../transport/rpc/rpc-operation'
import { homeListStyles } from '../home-list-styles'
import { MobileHomeSectionHeading } from '../MobileHomeSectionHeading'
import {
  backgroundTasksReadOp,
  backgroundTaskStopOp,
  estimateMobileWorkerEta,
  formatCompactDuration,
  formatWorkerAgentLabel,
  isWorkerActive,
  isWorkerFailed,
  normalizeWorkerAgentKey
} from './mobile-fork-background-tasks-rpc'

// Fork: orchestration background-task fleet card on Mobile Home Agents tab (FORK.md §15).

type HostWorkerEntry = {
  hostId: string
  hostName: string
  client: RpcClient
  worker: BackgroundTaskWorkerRecord
  snapshot: BackgroundTasksSnapshot
}

const POLL_INTERVAL_MS = 5_000

export function MobileForkBackgroundTasksSection(props: {
  hosts: readonly HostProfile[]
  hostFilter: string | null
  hostStates: Record<string, ConnectionState>
  allClients: readonly { hostId: string; client: RpcClient }[]
  now: number
  first?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [byHost, setByHost] = useState<Record<string, BackgroundTasksSnapshot>>({})
  const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(() => new Set())
  const stoppingRef = useRef<Set<string>>(new Set())
  const [stopError, setStopError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const connectedTargets = useMemo(() => {
    const clientMap = new Map(props.allClients.map((entry) => [entry.hostId, entry.client]))
    return props.hosts.flatMap((host) => {
      if (props.hostFilter !== null && host.id !== props.hostFilter) {
        return []
      }
      if (props.hostStates[host.id] !== 'connected') {
        return []
      }
      const client = clientMap.get(host.id)
      return client ? [{ host, client }] : []
    })
  }, [props.hosts, props.hostFilter, props.hostStates, props.allClients])

  useEffect(() => {
    if (connectedTargets.length === 0) {
      setByHost({})
      return
    }
    let cancelled = false
    const load = () => {
      void Promise.all(
        connectedTargets.map(async ({ host, client }) => {
          const snapshot = await runRpcOperation(client, backgroundTasksReadOp, {
            recentMinutes: 60
          }).catch(() => null)
          return { hostId: host.id, snapshot }
        })
      ).then((results) => {
        if (cancelled) {
          return
        }
        const next: Record<string, BackgroundTasksSnapshot> = {}
        for (const result of results) {
          if (result.snapshot) {
            next[result.hostId] = result.snapshot
          }
        }
        setByHost(next)
      })
    }
    load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [connectedTargets, refreshTick])

  const entries = useMemo((): HostWorkerEntry[] => {
    const list: HostWorkerEntry[] = []
    for (const { host, client } of connectedTargets) {
      const snapshot = byHost[host.id]
      if (!snapshot) {
        continue
      }
      for (const worker of snapshot.workers) {
        list.push({
          hostId: host.id,
          hostName: host.name,
          client,
          worker,
          snapshot
        })
      }
    }
    list.sort((a, b) => {
      const activeDiff = Number(isWorkerActive(b.worker)) - Number(isWorkerActive(a.worker))
      if (activeDiff !== 0) {
        return activeDiff
      }
      return b.worker.startedAt - a.worker.startedAt
    })
    return list.slice(0, 12)
  }, [connectedTargets, byHost])

  const onStop = useCallback((entry: HostWorkerEntry) => {
    const key = `${entry.hostId}:${entry.worker.dispatchId}`
    if (stoppingRef.current.has(key)) {
      return
    }
    triggerSelection()
    setStopError(null)
    const next = new Set(stoppingRef.current)
    next.add(key)
    stoppingRef.current = next
    setStoppingIds(next)
    void runRpcOperation(entry.client, backgroundTaskStopOp, {
      dispatch: entry.worker.dispatchId
    }).then(
      () => {
        const cleaned = new Set(stoppingRef.current)
        cleaned.delete(key)
        stoppingRef.current = cleaned
        setStoppingIds(cleaned)
        setRefreshTick((n) => n + 1)
      },
      (err: unknown) => {
        setStopError(err instanceof Error ? err.message : String(err))
        const cleaned = new Set(stoppingRef.current)
        cleaned.delete(key)
        stoppingRef.current = cleaned
        setStoppingIds(cleaned)
      }
    )
  }, [])

  if (entries.length === 0 && !stopError) {
    return null
  }

  const activeCount = entries.filter((entry) => isWorkerActive(entry.worker)).length
  const showHostName = connectedTargets.length > 1

  return (
    <View>
      <MobileHomeSectionHeading
        title={t('fork.backgroundTasks.heading', 'Background tasks')}
        count={activeCount > 0 ? activeCount : entries.length}
        aside={t('fork.backgroundTasks.refresh', 'Refresh')}
        onAsidePress={() => setRefreshTick((n) => n + 1)}
        first={props.first === true}
      />
      {stopError ? (
        <Text style={styles.errorBanner} numberOfLines={2}>
          {stopError}
        </Text>
      ) : null}
      <View style={homeListStyles.group}>
        {entries.map((entry, index) => {
          const { worker, snapshot } = entry
          const active = isWorkerActive(worker)
          const failed = isWorkerFailed(worker)
          const eta = estimateMobileWorkerEta(worker, snapshot, props.now)
          const elapsedMs = Math.max(0, (worker.completedAt ?? props.now) - worker.startedAt)
          const elapsed = formatCompactDuration(elapsedMs)
          const etaLabel =
            eta.kind === 'countdown' && eta.remainingMs !== null
              ? t('fork.backgroundTasks.etaLeft', '~{{time}} left (est.)', {
                  time: formatCompactDuration(eta.remainingMs)
                })
              : eta.kind === 'overrun'
                ? t('fork.backgroundTasks.etaOverrun', 'Over typical (est.)')
                : eta.kind === 'stalled'
                  ? t('fork.backgroundTasks.etaStalled', 'Stalled? (est.)')
                  : eta.kind === 'failed'
                    ? t('fork.backgroundTasks.failed', 'Failed')
                    : t('fork.backgroundTasks.done', 'Done')
          const agentKey = normalizeWorkerAgentKey(worker.agent)
          const badgeParts = [
            formatWorkerAgentLabel(worker.agent),
            worker.model,
            worker.account,
            showHostName ? entry.hostName : null
          ].filter(Boolean)
          const title =
            worker.taskTitle ||
            worker.displayName ||
            worker.objective ||
            t('fork.backgroundTasks.untitled', 'Delegated worker')
          const stopKey = `${entry.hostId}:${worker.dispatchId}`
          const stopping = stoppingIds.has(stopKey)
          return (
            <View key={stopKey}>
              {index > 0 ? <View style={styles.separator} /> : null}
              <View style={styles.card}>
                <View style={styles.leading}>
                  <MobileAgentIcon agentId={agentKey || 'claude'} size={18} />
                  <View style={styles.dotWrap}>
                    <AgentStateDot
                      state={active ? 'working' : failed ? 'failed' : 'done'}
                      decorative
                    />
                  </View>
                </View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {badgeParts.join(' · ')}
                  </Text>
                  <Text style={styles.timing} numberOfLines={1}>
                    {`${elapsed} · ${etaLabel}`}
                  </Text>
                  {active && eta.progressRatio !== null ? (
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.round(eta.progressRatio * 100)}%`,
                            backgroundColor:
                              eta.kind === 'overrun' ? colors.statusAmber : colors.accentBlue
                          }
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
                {active ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('fork.backgroundTasks.stopWorker', 'Stop {{title}}', {
                      title
                    })}
                    disabled={stopping}
                    onPress={() => onStop(entry)}
                    style={({ pressed }) => [
                      styles.stopBtn,
                      pressed && styles.pressed,
                      stopping && styles.disabled
                    ]}
                  >
                    {stopping ? (
                      <ActivityIndicator size="small" color={colors.statusRed} />
                    ) : (
                      <>
                        <Square size={10} color={colors.statusRed} fill={colors.statusRed} />
                        <Text style={styles.stopText}>
                          {t('fork.backgroundTasks.stop', 'Stop')}
                        </Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing.lg + 26 + spacing.sm
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11
  },
  leading: {
    width: 26,
    height: 26,
    borderRadius: radii.tile,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dotWrap: {
    position: 'absolute',
    right: -3,
    bottom: -3
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary
  },
  timing: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums']
  },
  track: {
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    overflow: 'hidden',
    marginTop: 4
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.statusRed + '1A'
  },
  stopText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.statusRed
  },
  pressed: {
    opacity: 0.65
  },
  disabled: {
    opacity: 0.5
  },
  errorBanner: {
    fontSize: 12,
    color: colors.statusRed,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs
  }
}))
