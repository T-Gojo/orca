import { StyleSheet } from 'react-native'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

// Fork: styles for MobileForkUsageWindowsSection (FORK.md §15).

export const forkUsageStyles = themedStyleSheet(() => ({
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  pill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.tile,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    gap: 2
  },
  pillActive: {
    backgroundColor: colors.skillTokenSurface
  },
  pillTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary
  },
  pillTitleActive: {
    color: colors.accentBlue
  },
  pillTotal: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums']
  },
  pillTotalActive: {
    color: colors.accentBlue
  },
  summaryCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    gap: 3
  },
  summaryTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums']
  },
  summarySplit: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums']
  },
  emptyRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  accountMain: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  accountTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary
  },
  accountSplit: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums']
  },
  accountTotal: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums']
  },
  modelRow: {
    paddingLeft: spacing.lg + 24,
    paddingRight: spacing.lg,
    paddingBottom: 8,
    gap: 1
  },
  modelName: {
    fontSize: 12,
    color: colors.textSecondary
  },
  modelMeta: {
    fontSize: 11,
    color: colors.textMuted,
    fontVariant: ['tabular-nums']
  },
  quotaCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    gap: 8
  },
  quotaHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  quotaTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary
  },
  activeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.skillTokenSurface
  },
  activeBadgeText: {
    fontSize: 11,
    color: colors.accentBlue
  }
}))
