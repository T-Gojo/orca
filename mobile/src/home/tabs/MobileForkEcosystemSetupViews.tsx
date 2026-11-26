import { useState } from 'react'
import { Image, Pressable, Text, TextInput, View } from 'react-native'
import { Download, QrCode, RotateCcw, Search } from 'lucide-react-native'
import type {
  EcosystemControlAction,
  EcosystemLearnResult,
  EcosystemStatusSnapshot
} from '../../../../src/shared/ecosystem/ecosystem-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

// Fork: Channels (WhatsApp QR + Telegram Token/Pairing) & Hermes Suite sub-views on Mobile (§16).

type SkillItem = NonNullable<EcosystemLearnResult['items']>[number]

export function MobileForkEcosystemChannelsView(props: {
  snapshot: EcosystemStatusSnapshot | null
  busy: string | null
  onControl: (
    action: EcosystemControlAction,
    extra?: {
      code?: string
      token?: string
      skillName?: string
      message?: string
      channel?: 'auto' | 'telegram' | 'whatsapp'
    }
  ) => void
}) {
  const t = useMobileTranslation()
  const [tgToken, setTgToken] = useState('')
  const [pairCode, setPairCode] = useState('')

  const tg = props.snapshot?.channels.find((c) => c.id === 'telegram') ?? null
  const wa = props.snapshot?.channels.find((c) => c.id === 'whatsapp') ?? null

  return (
    <View style={styles.stack}>
      <View style={styles.subCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.subTitle}>
            {t('fork.ecosystem.waTitle', 'WhatsApp (OpenClaw Multi-Device)')}
          </Text>
          <Text style={styles.stateLabel}>
            {wa?.state ?? t('fork.ecosystem.offline', 'offline')}
          </Text>
        </View>
        {wa?.detail ? <Text style={styles.detailText}>{wa.detail}</Text> : null}
        <View style={styles.buttonWrapRow}>
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null}
            onPress={() => props.onControl('whatsapp-login')}
            style={styles.primaryActionBtn}
          >
            <QrCode size={13} color={colors.background} />
            <Text style={styles.primaryActionText}>
              {t('fork.ecosystem.waGenerateQr', 'Generate WhatsApp QR')}
            </Text>
          </Pressable>
          {wa?.state === 'online' ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={props.busy !== null}
                onPress={() =>
                  props.onControl('notify', {
                    channel: 'whatsapp',
                    message: t(
                      'fork.ecosystem.waTestMsg',
                      'Orca OpenClaw WhatsApp link verified from phone.'
                    )
                  })
                }
                style={styles.outlineBtn}
              >
                <Text style={styles.outlineBtnText}>
                  {t('fork.ecosystem.sendTest', 'Send Test')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={props.busy !== null}
                onPress={() => props.onControl('whatsapp-logout')}
                style={styles.outlineBtn}
              >
                <Text style={styles.outlineBtnText}>
                  {t('fork.ecosystem.waDisconnect', 'Disconnect')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        {wa?.qrDataUrl ? (
          <View style={styles.qrBox}>
            <Image
              source={{ uri: wa.qrDataUrl }}
              style={styles.qrImage}
              accessibilityLabel={t('fork.ecosystem.waTitle', 'WhatsApp (OpenClaw Multi-Device)')}
            />
            <Text style={styles.qrHint}>
              {t(
                'fork.ecosystem.waQrHint',
                'Scan from WhatsApp › Linked Devices (or open OpenClaw & Hermes on your Mac to scan with this phone).'
              )}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.subCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.subTitle}>
            {t('fork.ecosystem.tgTitle', 'Telegram Bot & Pairing')}
          </Text>
          <Text style={styles.stateLabel}>
            {tg?.botUsername ?? tg?.state ?? t('fork.ecosystem.offline', 'offline')}
          </Text>
        </View>
        {tg?.detail ? <Text style={styles.detailText}>{tg.detail}</Text> : null}

        <View style={styles.inlineInputRow}>
          <TextInput
            value={tgToken}
            onChangeText={setTgToken}
            secureTextEntry
            placeholder={t('fork.ecosystem.tgPlaceholder', 'Paste @BotFather token…')}
            placeholderTextColor={colors.textMuted}
            style={styles.field}
            editable={props.busy === null}
          />
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null || !tgToken.trim()}
            onPress={() => {
              props.onControl('set-telegram-token', { token: tgToken.trim() })
              setTgToken('')
            }}
            style={[styles.primaryActionBtn, !tgToken.trim() && styles.disabled]}
          >
            <Text style={styles.primaryActionText}>
              {t('fork.ecosystem.tgSave', 'Save & Connect')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.inlineInputRow}>
          <TextInput
            value={pairCode}
            onChangeText={setPairCode}
            placeholder={t('fork.ecosystem.pairPlaceholder', '6-digit pairing code…')}
            placeholderTextColor={colors.textMuted}
            style={styles.field}
            editable={props.busy === null}
          />
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null || !pairCode.trim()}
            onPress={() => {
              props.onControl('approve-pairing', { code: pairCode.trim() })
              setPairCode('')
            }}
            style={[styles.outlineBtn, !pairCode.trim() && styles.disabled]}
          >
            <Text style={styles.outlineBtnText}>{t('fork.ecosystem.approve', 'Approve')}</Text>
          </Pressable>
          {tg?.state === 'online' ? (
            <Pressable
              accessibilityRole="button"
              disabled={props.busy !== null}
              onPress={() =>
                props.onControl('notify', {
                  channel: 'telegram',
                  message: t(
                    'fork.ecosystem.tgTestMsg',
                    'Orca OpenClaw Telegram verified from phone.'
                  )
                })
              }
              style={styles.outlineBtn}
            >
              <Text style={styles.outlineBtnText}>{t('fork.ecosystem.sendTest', 'Send Test')}</Text>
            </Pressable>
          ) : null}
        </View>

        {(props.snapshot?.pendingPairings ?? []).map((req) => (
          <View key={req.code} style={styles.pairItem}>
            <Text style={styles.pairText} numberOfLines={1}>
              {`${req.code} · ${req.channel} (${req.senderName ?? req.senderId})`}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={props.busy !== null}
              onPress={() => props.onControl('approve-pairing', { code: req.code })}
              style={styles.primaryActionBtn}
            >
              <Text style={styles.primaryActionText}>{t('fork.ecosystem.approve', 'Approve')}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  )
}

export function MobileForkEcosystemHermesView(props: {
  snapshot: EcosystemStatusSnapshot | null
  busy: string | null
  skillResults: readonly SkillItem[]
  onControl: (action: EcosystemControlAction, extra?: { skillName?: string }) => void
  onSearchSkills: (query: string) => void
  onInstallSkill: (target: string) => void
}) {
  const t = useMobileTranslation()
  const [query, setQuery] = useState('')

  return (
    <View style={styles.stack}>
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
            <Search size={13} color={colors.background} />
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
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  stack: { gap: spacing.sm },
  subCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
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
  stateLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  detailText: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  buttonWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: 2 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: 2 },
  field: {
    flex: 1,
    minHeight: 36,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.sm,
    fontSize: 12,
    color: colors.textPrimary
  },
  primaryActionBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  primaryActionText: { fontSize: 12, fontWeight: '600', color: colors.background },
  outlineBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  outlineBtnText: { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  disabled: { opacity: 0.45 },
  qrBox: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    gap: spacing.xs,
    marginTop: 4
  },
  qrImage: { width: 184, height: 184, borderRadius: radii.sm, backgroundColor: '#FFFFFF' },
  qrHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', lineHeight: 15 },
  pairItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle
  },
  pairText: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
  skillMeta: { flex: 1, gap: 1 },
  skillName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary }
}))
