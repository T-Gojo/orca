import { useState } from 'react'
import { Image, Pressable, Text, TextInput, View } from 'react-native'
import { QrCode } from 'lucide-react-native'
import type {
  EcosystemControlAction,
  EcosystemStatusSnapshot
} from '../../../../src/shared/ecosystem/ecosystem-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

// Fork: Channels (WhatsApp QR + Telegram Token/Pairing) sub-view on Mobile (§16).

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
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [tgToken, setTgToken] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [showTgForm, setShowTgForm] = useState(false)

  const tg = props.snapshot?.channels.find((c) => c.id === 'telegram') ?? null
  const wa = props.snapshot?.channels.find((c) => c.id === 'whatsapp') ?? null
  const tgConnected = tg?.state === 'online'
  const showWaQr = wa?.state === 'qr_ready' && Boolean(wa.qrDataUrl)

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
            <QrCode size={13} color={colors.onAccent} />
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
        {showWaQr && wa?.qrDataUrl ? (
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
          {tgConnected ? (
            <View style={styles.connectedPill}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>
                {t('fork.ecosystem.connectedBadge', 'Connected')}
              </Text>
            </View>
          ) : (
            <Text style={styles.stateLabel}>
              {tg?.state ?? t('fork.ecosystem.offline', 'offline')}
            </Text>
          )}
        </View>
        <Text style={styles.detailText}>
          {tgConnected
            ? `${tg?.botUsername ?? '@bot'} · ${tg?.detail ?? ''}`
            : (tg?.detail ?? t('fork.ecosystem.offline', 'offline'))}
        </Text>

        {tgConnected ? (
          <View style={styles.buttonWrapRow}>
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
              style={styles.primaryActionBtn}
            >
              <Text style={styles.primaryActionText}>
                {t('fork.ecosystem.sendTest', 'Send Test')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowTgForm((v) => !v)}
              style={styles.outlineBtn}
            >
              <Text style={styles.outlineBtnText}>
                {showTgForm
                  ? t('fork.ecosystem.hideConfig', 'Hide Setup')
                  : t('fork.ecosystem.manageToken', 'Change Token / Pair')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!tgConnected || showTgForm ? (
          <>
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
                  setShowTgForm(false)
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
            </View>
          </>
        ) : null}

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

const styles = themedStyleSheet(() => ({
  stack: { gap: spacing.sm },
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
  stateLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.mergeGreen
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.mergeGreen
  },
  connectedText: { fontSize: 11, fontWeight: '700', color: colors.mergeGreen },
  detailText: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  buttonWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: 2 },
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
  qrBox: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bgRaised,
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
