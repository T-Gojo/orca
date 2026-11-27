import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Download, RotateCcw, Search } from 'lucide-react-native'
import type {
  EcosystemControlAction,
  EcosystemLearnResult,
  EcosystemStatusSnapshot
} from '../../../../src/shared/ecosystem/ecosystem-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

// Fork: Hermes Skills & Auto-Learn card inside Mobile Setup & Skills view (§16).

type SkillItem = NonNullable<EcosystemLearnResult['items']>[number]

export function MobileForkEcosystemHermesView(props: {
  snapshot: EcosystemStatusSnapshot | null
  busy: string | null
  skillResults: readonly SkillItem[]
  onControl: (action: EcosystemControlAction, extra?: { skillName?: string }) => void
  onSearchSkills: (query: string) => void
  onInstallSkill: (target: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [query, setQuery] = useState('')

  return (
    <View style={styles.subCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.subTitle}>
          {t('fork.ecosystem.pillHermes', 'Hermes ({{count}})', {
            count: props.snapshot?.hermes.installedSkillsCount ?? 0
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={props.busy !== null}
          onPress={() => props.onControl('toggle-auto-learn')}
          style={styles.outlineBtn}
        >
          <Text style={styles.outlineBtnText}>
            {props.snapshot?.hermes.autoLearnEnabled
              ? t('fork.ecosystem.autoLearnOn', 'Auto-Learn: On')
              : t('fork.ecosystem.autoLearnOff', 'Auto-Learn: Paused')}
          </Text>
        </Pressable>
      </View>
      {props.snapshot?.hermes.detail ? (
        <Text style={styles.detailText}>{props.snapshot.hermes.detail}</Text>
      ) : null}

      <View style={styles.inlineInputRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('fork.ecosystem.skillsPlaceholder', 'Search 1,426+ skills…')}
          placeholderTextColor={colors.textMuted}
          style={styles.field}
          editable={props.busy === null}
          returnKeyType="search"
          onSubmitEditing={() => query.trim() && props.onSearchSkills(query.trim())}
        />
        <Pressable
          accessibilityRole="button"
          disabled={props.busy !== null || !query.trim()}
          onPress={() => props.onSearchSkills(query.trim())}
          style={[styles.primaryActionBtn, !query.trim() && styles.disabled]}
        >
          <Search size={13} color={colors.onAccent} />
          <Text style={styles.primaryActionText}>{t('fork.ecosystem.searchBtn', 'Search')}</Text>
        </Pressable>
      </View>

      {props.skillResults.slice(0, 5).map((item) => (
        <View key={`${item.source}:${item.name}`} style={styles.pairItem}>
          <View style={styles.skillMeta}>
            <Text style={styles.skillName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.detailText} numberOfLines={1}>
              {item.description}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null}
            onPress={() => props.onInstallSkill(item.url ?? item.name)}
            style={styles.outlineBtn}
          >
            <Download size={12} color={colors.textPrimary} />
            <Text style={styles.outlineBtnText}>{t('fork.ecosystem.installBtn', 'Install')}</Text>
          </Pressable>
        </View>
      ))}

      {(props.snapshot?.hermes.recentLearnedSkills ?? []).slice(0, 4).map((entry) => (
        <View key={entry.backupId} style={styles.pairItem}>
          <View style={styles.skillMeta}>
            <Text style={styles.skillName} numberOfLines={1}>
              {entry.skillName}
            </Text>
            <Text style={styles.detailText} numberOfLines={1}>
              {entry.description}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null}
            onPress={() => props.onControl('undo-skill', { skillName: entry.backupId })}
            style={styles.outlineBtn}
          >
            <RotateCcw size={12} color={colors.textSecondary} />
            <Text style={styles.outlineBtnText}>
              {t('fork.ecosystem.undoSkill', 'Undo {{name}}', { name: entry.skillName })}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  subCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    padding: spacing.sm,
    gap: spacing.xs
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs
  },
  subTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  detailText: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: 2 },
  field: {
    flex: 1,
    minHeight: 36,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm,
    fontSize: 12,
    color: colors.textPrimary
  },
  primaryActionBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.accentBlue,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  primaryActionText: { fontSize: 12, fontWeight: '600', color: colors.onAccent },
  outlineBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.bgRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  outlineBtnText: { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  disabled: { opacity: 0.45 },
  pairItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle
  },
  skillMeta: { flex: 1, gap: 1 },
  skillName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary }
}))
