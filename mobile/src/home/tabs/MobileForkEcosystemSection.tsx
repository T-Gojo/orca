import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { RotateCcw, Send, ShieldCheck, Sparkles } from 'lucide-react-native'
import type {
  EcosystemControlAction,
  EcosystemStatusSnapshot
} from '../../../../src/shared/ecosystem/ecosystem-types'
import { AgentStateDot } from '../../agents/presentation/AgentStateDot'
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
  ecosystemAskOp,
  ecosystemControlOp,
  ecosystemLearnOp,
  ecosystemStatusReadOp
} from './mobile-fork-ecosystem-rpc'

// Fork: unified Ecosystem & Ask-Mac-Now control card on Mobile Home Agents tab (FORK.md §16).

export function MobileForkEcosystemSection(props: {
  hosts: readonly HostProfile[]
  hostFilter: string | null
  hostStates: Record<string, ConnectionState>
  allClients: readonly { hostId: string; client: RpcClient }[]
  first?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [snapshot, setSnapshot] = useState<EcosystemStatusSnapshot | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [replyText, setReplyText] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const primaryTarget = useMemo(() => {
    const clientMap = new Map(props.allClients.map((entry) => [entry.hostId, entry.client]))
    for (const host of props.hosts) {
      if (props.hostFilter !== null && host.id !== props.hostFilter) {
        continue
      }
      if (props.hostStates[host.id] !== 'connected') {
        continue
      }
      const client = clientMap.get(host.id)
      if (client) {
        return { host, client }
      }
    }
    return null
  }, [props.hosts, props.hostFilter, props.hostStates, props.allClients])

  useEffect(() => {
    if (!primaryTarget) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    void runRpcOperation(primaryTarget.client, ecosystemStatusReadOp, {}).then(
      (res) => {
        if (!cancelled && res) {
          setSnapshot(res)
        }
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [primaryTarget, tick])

  const onControl = useCallback(
    (action: EcosystemControlAction, extra: { code?: string; skillName?: string } = {}) => {
      if (!primaryTarget || busy) {
        return
      }
      triggerSelection()
      setBusy(action)
      setBanner(null)
      void runRpcOperation(primaryTarget.client, ecosystemControlOp, { action, ...extra }).then(
        (res) => {
          setSnapshot(res.status)
          setBanner(res.detail)
          setBusy(null)
        },
        (err: unknown) => {
          setBanner(err instanceof Error ? err.message : String(err))
          setBusy(null)
        }
      )
    },
    [primaryTarget, busy]
  )

  const onAskMac = useCallback(() => {
    const trimmed = prompt.trim()
    if (!primaryTarget || !trimmed || busy) {
      return
    }
    triggerSelection()
    setBusy('ask')
    setBanner(null)
    setReplyText(null)
    void runRpcOperation(primaryTarget.client, ecosystemAskOp, {
      prompt: trimmed,
      source: 'orca-mobile',
      wait: true
    }).then(
      (res) => {
        setPrompt('')
        if (res.reply) {
          setReplyText(res.reply)
        } else {
          setBanner(
            res.accepted
              ? t(
                  'fork.ecosystem.dispatched',
                  'Sent to {{agent}} on Mac ({{count}} Rikugan items)',
                  {
                    agent: res.routedAgent ?? 'Orca HQ',
                    count: res.rikuganItemsAttached
                  }
                )
              : (res.error ?? 'Dispatch failed')
          )
        }
        setBusy(null)
        setTick((n) => n + 1)
      },
      (err: unknown) => {
        setBanner(err instanceof Error ? err.message : String(err))
        setBusy(null)
      }
    )
  }, [primaryTarget, prompt, busy, t])

  const onReviewMac = useCallback(() => {
    if (!primaryTarget || busy) {
      return
    }
    triggerSelection()
    setBusy('review')
    void runRpcOperation(primaryTarget.client, ecosystemLearnOp, {
      mode: 'review',
      focus: prompt.trim() || 'current workspace changes'
    }).then(
      (res) => {
        setBanner(res.summary)
        setBusy(null)
      },
      (err: unknown) => {
        setBanner(err instanceof Error ? err.message : String(err))
        setBusy(null)
      }
    )
  }, [primaryTarget, prompt, busy])

  if (!primaryTarget) {
    return null
  }

  const tg = snapshot?.channels.find((c) => c.id === 'telegram')
  const wa = snapshot?.channels.find((c) => c.id === 'whatsapp')
  const latestSkill = snapshot?.hermes.recentLearnedSkills[0] ?? null

  return (
    <View>
      <MobileHomeSectionHeading
        title={t('fork.ecosystem.heading', 'Mac Ecosystem · Rikugan · OpenClaw · Hermes')}
        aside={
          snapshot?.bridgeRunning
            ? t('fork.ecosystem.sync', 'Sync')
            : t('fork.ecosystem.bringUp', 'Bring Up')
        }
        onAsidePress={() => onControl(snapshot?.bridgeRunning ? 'sync' : 'up')}
        first={props.first === true}
      />
      <View style={homeListStyles.group}>
        <View style={styles.card}>
          <View style={styles.inputRow}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder={t(
                'fork.ecosystem.askPlaceholder',
                'Ask Rikugan or run a task on your open Mac…'
              )}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              editable={busy === null}
              returnKeyType="send"
              onSubmitEditing={onAskMac}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('fork.ecosystem.sendToMac', 'Send to Mac')}
              disabled={busy !== null || prompt.trim().length === 0}
              onPress={onAskMac}
              style={[styles.sendBtn, (busy !== null || !prompt.trim()) && styles.disabled]}
            >
              {busy === 'ask' ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Send size={15} color={colors.background} />
              )}
            </Pressable>
          </View>

          <View style={styles.pillsRow}>
            <View style={styles.pill}>
              <AgentStateDot
                state={snapshot?.rikugan.state === 'online' ? 'done' : 'failed'}
                decorative
              />
              <Text style={styles.pillText}>{t('fork.ecosystem.pillRikugan', 'Rikugan')}</Text>
            </View>
            <View style={styles.pill}>
              <AgentStateDot state={tg?.state === 'online' ? 'done' : 'idle'} decorative />
              <Text style={styles.pillText}>{t('fork.ecosystem.pillTelegram', 'Telegram')}</Text>
            </View>
            <View style={styles.pill}>
              <AgentStateDot state={wa?.state === 'online' ? 'done' : 'idle'} decorative />
              <Text style={styles.pillText}>{t('fork.ecosystem.pillWhatsApp', 'WhatsApp')}</Text>
            </View>
            <View style={styles.pill}>
              <Sparkles size={11} color={colors.textSecondary} />
              <Text style={styles.pillText}>
                {t('fork.ecosystem.pillHermes', 'Hermes ({{count}})', {
                  count: snapshot?.hermes.installedSkillsCount ?? 0
                })}
              </Text>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={onReviewMac}
              style={styles.secondaryBtn}
            >
              <ShieldCheck size={13} color={colors.textPrimary} />
              <Text style={styles.secondaryBtnText}>
                {t('fork.ecosystem.reviewBtn', '/review on Mac')}
              </Text>
            </Pressable>
            {latestSkill ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => onControl('undo-skill', { skillName: latestSkill.backupId })}
                style={styles.secondaryBtn}
              >
                <RotateCcw size={13} color={colors.textSecondary} />
                <Text style={styles.secondaryBtnText} numberOfLines={1}>
                  {t('fork.ecosystem.undoSkill', 'Undo {{name}}', {
                    name: latestSkill.skillName
                  })}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {(snapshot?.pendingPairings ?? []).map((req) => (
            <View key={req.code} style={styles.pairingRow}>
              <Text style={styles.pairingText} numberOfLines={1}>
                {`${req.code} · ${req.channel} (${req.senderName ?? req.senderId})`}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => onControl('approve-pairing', { code: req.code })}
                style={styles.approveBtn}
              >
                <Text style={styles.approveBtnText}>{t('fork.ecosystem.approve', 'Approve')}</Text>
              </Pressable>
            </View>
          ))}

          {banner ? (
            <Text style={styles.banner} numberOfLines={3}>
              {banner}
            </Text>
          ) : null}
          {replyText ? (
            <View style={styles.replyBox}>
              <Text style={styles.replyText}>{replyText}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  card: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  input: {
    flex: 1,
    minHeight: 38,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 2,
    fontSize: 16,
    color: colors.textPrimary
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabled: {
    opacity: 0.45
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: colors.surface
  },
  pillText: {
    fontSize: 12,
    color: colors.textSecondary
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary
  },
  pairingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: 4
  },
  pairingText: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary
  },
  approveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.background
  },
  banner: {
    fontSize: 12,
    color: colors.textSecondary
  },
  replyBox: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.sm
  },
  replyText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary
  }
}))
