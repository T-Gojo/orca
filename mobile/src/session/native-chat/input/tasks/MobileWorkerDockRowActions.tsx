import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Square, X } from 'lucide-react-native'
import {
  workerDockClearable,
  type WorkerDockEntry
} from '../../../../../../src/shared/orchestration/dock/worker-dock'
import { useMobileTranslation } from '../../../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../../theme/use-mobile-color-scheme'
import { canStopDockRow, type MobileWorkerDockActions } from './use-mobile-worker-dock-actions'

// Fork: Stop / Clear controls rendered inside MobileNativeChatWorkerDock rows (FORK.md §15).

export function MobileWorkerDockRowAction({
  row,
  actions
}: {
  row: WorkerDockEntry
  actions: MobileWorkerDockActions
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  if (!actions.available) {
    return null
  }
  const busy = actions.busyIds.has(row.id)
  const canStop = canStopDockRow(row)
  const canClear = !canStop && workerDockClearable(row)
  if (!canStop && !canClear) {
    return null
  }
  const label = canStop ? t('fork.workerDock.stop', 'Stop') : t('fork.workerDock.clear', 'Clear')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        canStop
          ? t('fork.workerDock.stopWorker', 'Stop {{name}}', { name: row.title || row.name })
          : t('fork.workerDock.clearWorker', 'Clear {{name}}', { name: row.title || row.name })
      }
      disabled={busy}
      onPress={() => (canStop ? actions.onStop(row) : actions.onClear(row))}
      style={({ pressed }) => [
        styles.actionBtn,
        canStop ? styles.stopBtn : styles.clearBtn,
        pressed && styles.pressed,
        busy && styles.disabled
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={canStop ? colors.statusRed : colors.textSecondary} />
      ) : canStop ? (
        <Square size={11} color={colors.statusRed} fill={colors.statusRed} />
      ) : (
        <X size={12} color={colors.textSecondary} strokeWidth={2.2} />
      )}
      <Text style={[styles.actionText, canStop ? styles.stopText : styles.clearText]}>{label}</Text>
    </Pressable>
  )
}

export function MobileWorkerDockSheetFooter({
  rows,
  actions
}: {
  rows: readonly WorkerDockEntry[]
  actions?: MobileWorkerDockActions
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const clearableCount = rows.filter((row) => workerDockClearable(row)).length
  if (!actions || !actions.available) {
    return (
      <Text style={styles.footer}>
        {t(
          'components.native-chat.workerDock.stopOnComputer',
          'Stop or clear workers on the computer they run on'
        )}
      </Text>
    )
  }
  return (
    <View style={styles.footerRow}>
      {actions.error ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {actions.error}
        </Text>
      ) : (
        <Text style={styles.footerHint}>
          {t('fork.workerDock.controlsHint', 'Tap Stop or Clear to manage workers directly.')}
        </Text>
      )}
      {clearableCount > 1 ? (
        <Pressable
          accessibilityRole="button"
          disabled={actions.clearingAll}
          onPress={() => actions.onClearAll(rows)}
          style={({ pressed }) => [styles.clearAllBtn, pressed && styles.pressed]}
        >
          {actions.clearingAll ? (
            <ActivityIndicator size="small" color={colors.accentBlue} />
          ) : (
            <Text style={styles.clearAllText}>
              {t('fork.workerDock.clearAll', 'Clear all ({{count}})', { count: clearableCount })}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    marginRight: spacing.md
  },
  stopBtn: {
    backgroundColor: colors.statusRed + '1A'
  },
  clearBtn: {
    backgroundColor: colors.translucentFill
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600'
  },
  stopText: {
    color: colors.statusRed
  },
  clearText: {
    color: colors.textSecondary
  },
  pressed: {
    opacity: 0.65
  },
  disabled: {
    opacity: 0.5
  },
  footer: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  footerHint: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.statusRed
  },
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.skillTokenSurface
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentBlue
  }
}))
