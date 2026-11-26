import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { QrCode, Sparkles } from 'lucide-react-native'
import type {
  EcosystemControlAction,
  EcosystemLearnResult,
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
import { MobileForkEcosystemChatView, type MobileChatMode } from './MobileForkEcosystemChatView'
import {
  MobileForkEcosystemChannelsView,
  MobileForkEcosystemHermesView
} from './MobileForkEcosystemSetupViews'

// Fork: unified OpenClaw & Hermes Chat + Setup Hub on Mobile Feed, Bots, and Agents tabs (FORK.md §16).

type HubSubTab = 'chat' | 'channels' | 'hermes'
type SkillItem = NonNullable<EcosystemLearnResult['items']>[number]

export function MobileForkEcosystemSection(props: {
  hosts: readonly HostProfile[]
  hostFilter: string | null
  hostStates: Record<string, ConnectionState>
  allClients: readonly { hostId: string; client: RpcClient }[]
  onPairDesktop?: () => void
  first?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [subTab, setSubTab] = useState<HubSubTab>('chat')
  const [snapshot, setSnapshot] = useState<EcosystemStatusSnapshot | null>(null)
  const [skillResults, setSkillResults] = useState<SkillItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
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
    (
      action: EcosystemControlAction,
      extra: {
        code?: string
        token?: string
        skillName?: string
        message?: string
        channel?: 'auto' | 'telegram' | 'whatsapp'
      } = {}
    ) => {
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

  const onRunHermes = useCallback(
    (mode: 'learn' | 'review' | 'skills-search' | 'skills-install', value: string) => {
      if (!primaryTarget || busy) {
        return
      }
      triggerSelection()
      setBusy(mode)
      setBanner(null)
      void runRpcOperation(primaryTarget.client, ecosystemLearnOp, {
        mode,
        ...(mode === 'learn' ? { topic: value } : {}),
        ...(mode === 'review' ? { focus: value } : {}),
        ...(mode === 'skills-search' || mode === 'skills-install' ? { query: value } : {})
      }).then(
        (res) => {
          if (mode === 'skills-search') {
            setSkillResults(res.items ?? [])
          }
          setBanner(res.summary)
          setBusy(null)
          setTick((n) => n + 1)
        },
        (err: unknown) => {
          setBanner(err instanceof Error ? err.message : String(err))
          setBusy(null)
        }
      )
    },
    [primaryTarget, busy]
  )

  const onSendChat = useCallback(
    (trimmed: string, mode: MobileChatMode, useRikugan: boolean) => {
      if (!primaryTarget || busy) {
        return
      }
      if (mode === 'review') {
        onRunHermes('review', trimmed)
        return
      }
      if (mode === 'learn') {
        onRunHermes('learn', trimmed)
        return
      }
      triggerSelection()
      setBusy('ask')
      setBanner(null)
      void runRpcOperation(primaryTarget.client, ecosystemAskOp, {
        prompt: trimmed,
        source: 'orca-mobile',
        wait: true,
        ...(useRikugan ? { rikugan: true } : {})
      }).then(
        (res) => {
          if (!res.reply) {
            setBanner(
              res.accepted
                ? t('fork.ecosystem.dispatched', 'Sent to {{agent}} on Mac', {
                    agent: res.routedAgent ?? 'Orca HQ'
                  })
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
    },
    [primaryTarget, busy, onRunHermes, t]
  )

  if (!primaryTarget) {
    if (!props.onPairDesktop) {
      return null
    }
    return (
      <View>
        <MobileHomeSectionHeading
          title={t('fork.ecosystem.heading', 'OpenClaw & Hermes Hub')}
          first={props.first === true}
        />
        <View style={homeListStyles.group}>
          <View style={styles.card}>
            <Text style={styles.emptyHint}>
              {t(
                'fork.ecosystem.pairMacFirst',
                'Connect your Mac to chat with OpenClaw & Hermes and set up WhatsApp & Telegram.'
              )}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={props.onPairDesktop}
              style={styles.pairMacBtn}
            >
              <QrCode size={15} color={colors.background} />
              <Text style={styles.pairMacBtnText}>
                {t('fork.ecosystem.pairMacBtn', 'Scan Mac Pairing QR')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  const tg = snapshot?.channels.find((c) => c.id === 'telegram')
  const wa = snapshot?.channels.find((c) => c.id === 'whatsapp')
  const messages = (snapshot?.chatMessages ?? []).slice(-12)

  return (
    <View>
      <MobileHomeSectionHeading
        title={t('fork.ecosystem.heading', 'OpenClaw & Hermes Hub')}
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
          <View style={styles.tabsRow}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: subTab === 'chat' }}
              onPress={() => setSubTab('chat')}
              style={[styles.tabBtn, subTab === 'chat' && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, subTab === 'chat' && styles.tabTextActive]}>
                {t('fork.ecosystem.tabChat', 'Chat')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: subTab === 'channels' }}
              onPress={() => setSubTab('channels')}
              style={[styles.tabBtn, subTab === 'channels' && styles.tabBtnActive]}
            >
              <AgentStateDot
                state={wa?.state === 'online' || tg?.state === 'online' ? 'done' : 'idle'}
                decorative
              />
              <Text style={[styles.tabText, subTab === 'channels' && styles.tabTextActive]}>
                {t('fork.ecosystem.tabChannels', 'WhatsApp · Telegram')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: subTab === 'hermes' }}
              onPress={() => setSubTab('hermes')}
              style={[styles.tabBtn, subTab === 'hermes' && styles.tabBtnActive]}
            >
              <Sparkles size={11} color={colors.textSecondary} />
              <Text style={[styles.tabText, subTab === 'hermes' && styles.tabTextActive]}>
                {t('fork.ecosystem.tabHermes', 'Hermes')}
              </Text>
            </Pressable>
          </View>

          {banner ? <Text style={styles.bannerText}>{banner}</Text> : null}

          {subTab === 'chat' ? (
            <MobileForkEcosystemChatView
              messages={messages}
              busy={busy}
              onSendChat={onSendChat}
              onClearChat={() => onControl('clear-chat')}
            />
          ) : subTab === 'channels' ? (
            <MobileForkEcosystemChannelsView
              snapshot={snapshot}
              busy={busy}
              onControl={onControl}
            />
          ) : (
            <MobileForkEcosystemHermesView
              snapshot={snapshot}
              busy={busy}
              skillResults={skillResults}
              onControl={onControl}
              onSearchSkills={(q) => onRunHermes('skills-search', q)}
              onInstallSkill={(target) => onRunHermes('skills-install', target)}
            />
          )}
        </View>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  card: { padding: spacing.md, gap: spacing.sm },
  tabsRow: { flexDirection: 'row', gap: spacing.xs },
  tabBtn: {
    flex: 1,
    minHeight: 32,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.xs
  },
  tabBtnActive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.textSecondary
  },
  tabText: { fontSize: 11, fontWeight: '500', color: colors.textSecondary },
  tabTextActive: { fontWeight: '700', color: colors.textPrimary },
  emptyHint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  bannerText: { fontSize: 12, color: colors.textSecondary },
  pairMacBtn: {
    minHeight: 40,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs
  },
  pairMacBtnText: { fontSize: 13, fontWeight: '600', color: colors.background }
}))
