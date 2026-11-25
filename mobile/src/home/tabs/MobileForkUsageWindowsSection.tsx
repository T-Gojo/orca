import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { UsageBar } from '../../accounts/usage/UsageBar'
import { MobileAgentIcon } from '../../components/icons/MobileAgentIcon'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { runRpcOperation } from '../../transport/rpc/rpc-operation'
import { homeListStyles } from '../home-list-styles'
import { MobileHomeSectionHeading } from '../MobileHomeSectionHeading'
import { forkUsageStyles as styles } from './mobile-fork-usage-styles'
import {
  delegationUsageOp,
  delegationUsageWindowsOp,
  formatCompactTokens,
  formatForkProviderLabel,
  formatResetCountdown,
  MOBILE_USAGE_WINDOWS,
  providerToAgentIconId,
  type MobileDelegationAccountUsage,
  type MobileUsageWindow,
  type MobileUsageWindowsSnapshot
} from './mobile-fork-usage-rpc'

// Fork: token windows (1h/5h/7d/all) and multi-CLI quota cards on Mobile Home Usage tab (FORK.md §15).

const EXTRA_QUOTA_AGENTS = new Set(['kiro', 'antigravity', 'mistral-vibe', 'opencode'])

export function MobileForkUsageWindowsSection(props: {
  hostId: string
  client: RpcClient | null
  connected: boolean
  refreshToken: number
  now: number
  onOpenAccounts: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [selectedWindow, setSelectedWindow] = useState<MobileUsageWindow>('5h')
  const [windowsSnapshot, setWindowsSnapshot] = useState<MobileUsageWindowsSnapshot | null>(null)
  const [delegationUsage, setDelegationUsage] = useState<MobileDelegationAccountUsage[]>([])
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (!props.client || !props.connected) {
      setWindowsSnapshot(null)
      return
    }
    let cancelled = false
    void runRpcOperation(props.client, delegationUsageWindowsOp, { window: selectedWindow })
      .then((snapshot) => {
        if (!cancelled) {
          setWindowsSnapshot(snapshot)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [props.client, props.connected, props.hostId, selectedWindow, props.refreshToken])

  useEffect(() => {
    if (!props.client || !props.connected) {
      setDelegationUsage([])
      return
    }
    let cancelled = false
    void runRpcOperation(props.client, delegationUsageOp, { refresh: false })
      .then((res) => {
        if (!cancelled && res) {
          setDelegationUsage(res.usage)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [props.client, props.connected, props.hostId, props.refreshToken])

  const extraQuotas = useMemo(
    () => delegationUsage.filter((entry) => EXTRA_QUOTA_AGENTS.has(entry.agent)),
    [delegationUsage]
  )

  const activeSummary = useMemo(
    () => windowsSnapshot?.summaries.find((entry) => entry.window === selectedWindow) ?? null,
    [windowsSnapshot, selectedWindow]
  )

  const toggleRow = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  if (!props.connected) {
    return null
  }

  const windowLabels: Record<MobileUsageWindow, string> = {
    '1h': t('fork.usageWindows.window1h', '1h'),
    '5h': t('fork.usageWindows.window5h', '5h'),
    '7d': t('fork.usageWindows.window7d', '7d'),
    all: t('fork.usageWindows.windowAll', 'All')
  }

  return (
    <View>
      {windowsSnapshot ? (
        <View>
          <MobileHomeSectionHeading
            title={t('fork.usageWindows.heading', 'Token windows')}
            first={false}
          />
          <View style={styles.pillRow}>
            {MOBILE_USAGE_WINDOWS.map((win) => {
              const summary = windowsSnapshot.summaries.find((s) => s.window === win)
              const active = win === selectedWindow
              return (
                <Pressable
                  key={win}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelectedWindow(win)}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text style={[styles.pillTitle, active && styles.pillTitleActive]}>
                    {windowLabels[win]}
                  </Text>
                  <Text style={[styles.pillTotal, active && styles.pillTotalActive]}>
                    {formatCompactTokens(summary?.totalTokens ?? 0)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <View style={homeListStyles.group}>
            {activeSummary ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTotal}>
                  {t('fork.usageWindows.totalTokens', '{{total}} tokens', {
                    total: formatCompactTokens(activeSummary.totalTokens)
                  })}
                </Text>
                <Text style={styles.summarySplit}>
                  {t(
                    'fork.usageWindows.tokenSplit',
                    'In {{input}} · Out {{output}} · Cache {{cache}}',
                    {
                      input: formatCompactTokens(activeSummary.inputTokens),
                      output: formatCompactTokens(activeSummary.outputTokens),
                      cache: formatCompactTokens(activeSummary.cacheTokens)
                    }
                  )}
                </Text>
              </View>
            ) : null}
            {windowsSnapshot.rows.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>
                  {t('fork.usageWindows.noActivity', 'No recorded token usage in this window.')}
                </Text>
              </View>
            ) : (
              windowsSnapshot.rows.map((row) => {
                const rowKey = `${row.provider}:${row.accountKey}`
                const expanded = expandedKeys.has(rowKey)
                const hasModels = row.models.length > 0
                const accountLabel =
                  row.label ||
                  (row.removed ? t('fork.usageWindows.removedAccount', 'Removed') : row.accountKey)
                return (
                  <View key={rowKey} style={styles.rowBorder}>
                    <Pressable
                      disabled={!hasModels}
                      onPress={() => toggleRow(rowKey)}
                      style={({ pressed }) => [styles.accountRow, pressed && styles.rowPressed]}
                    >
                      <MobileAgentIcon agentId={providerToAgentIconId(row.provider)} size={16} />
                      <View style={styles.accountMain}>
                        <Text style={styles.accountTitle} numberOfLines={1}>
                          {`${formatForkProviderLabel(row.provider)} · ${accountLabel}`}
                        </Text>
                        <Text style={styles.accountSplit} numberOfLines={1}>
                          {t(
                            'fork.usageWindows.rowSplit',
                            'In {{input}} · Out {{output}} · Cache {{cache}}',
                            {
                              input: formatCompactTokens(row.inputTokens),
                              output: formatCompactTokens(row.outputTokens),
                              cache: formatCompactTokens(row.cacheTokens)
                            }
                          )}
                        </Text>
                      </View>
                      <Text style={styles.accountTotal}>
                        {formatCompactTokens(row.totalTokens)}
                      </Text>
                      {hasModels ? (
                        expanded ? (
                          <ChevronDown size={14} color={colors.textMuted} />
                        ) : (
                          <ChevronRight size={14} color={colors.textMuted} />
                        )
                      ) : null}
                    </Pressable>
                    {expanded
                      ? row.models.map((model) => (
                          <View key={model.model} style={styles.modelRow}>
                            <Text style={styles.modelName} numberOfLines={1}>
                              {model.model}
                            </Text>
                            <Text style={styles.modelMeta} numberOfLines={1}>
                              {`${formatCompactTokens(model.inputTokens)} / ${formatCompactTokens(model.outputTokens)} / ${formatCompactTokens(model.cacheTokens)} · ${formatCompactTokens(model.totalTokens)}`}
                            </Text>
                          </View>
                        ))
                      : null}
                  </View>
                )
              })
            )}
          </View>
        </View>
      ) : null}

      {extraQuotas.length > 0 ? (
        <View>
          <MobileHomeSectionHeading
            title={t('fork.usageWindows.multiCliQuotas', 'Other CLI quotas')}
            aside={t('fork.usageWindows.manageAccounts', 'Accounts')}
            onAsidePress={props.onOpenAccounts}
            first={false}
          />
          <View style={homeListStyles.group}>
            {extraQuotas.map((entry, index) => {
              const title = `${formatForkProviderLabel(entry.agent)} · ${entry.label ?? entry.accountId ?? t('accounts.screen.default', 'System default')}`
              const primaryWindow = entry.windows[0] ?? null
              const resetShort = primaryWindow
                ? formatResetCountdown(primaryWindow.resetsAt, props.now)
                : null
              const resetText = resetShort
                ? t('fork.usageWindows.resetsIn', 'Resets in {{time}}', { time: resetShort })
                : undefined
              const windowTag =
                primaryWindow?.name === 'monthly'
                  ? t('fork.usageWindows.monthlyShort', '30d')
                  : primaryWindow?.name === 'weekly'
                    ? t('accounts.screen.weeklyWindow', '7d')
                    : t('accounts.screen.sessionWindow', '5h')
              return (
                <Pressable
                  key={`${entry.agent}:${entry.accountId ?? 'system'}`}
                  onPress={props.onOpenAccounts}
                  style={({ pressed }) => [
                    styles.quotaCard,
                    index > 0 && styles.rowBorder,
                    pressed && styles.rowPressed
                  ]}
                >
                  <View style={styles.quotaHead}>
                    <MobileAgentIcon agentId={entry.agent} size={16} />
                    <Text style={styles.quotaTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    {entry.active ? (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText}>
                          {t('home.usage.active', 'Active')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <UsageBar
                    label={windowTag}
                    usedPercent={entry.usedPercent}
                    unavailable={entry.usedPercent === null}
                    resetText={resetText}
                  />
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}
    </View>
  )
}
