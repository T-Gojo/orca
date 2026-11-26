import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react-native'
import type { EcosystemChatMessage } from '../../../../src/shared/ecosystem/ecosystem-types'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

// Fork: shared multi-surface Chat sub-view inside Mobile OpenClaw & Hermes Hub (§16).

export type MobileChatMode = 'chat' | 'review' | 'learn'

export function MobileForkEcosystemChatView(props: {
  messages: readonly EcosystemChatMessage[]
  busy: string | null
  onSendChat: (text: string, mode: MobileChatMode, useRikugan: boolean) => void
  onClearChat: () => void
}) {
  const t = useMobileTranslation()
  const [prompt, setPrompt] = useState('')
  const [chatMode, setChatMode] = useState<MobileChatMode>('chat')
  const [useRikugan, setUseRikugan] = useState(false)

  const handleSend = () => {
    const trimmed = prompt.trim()
    if (!trimmed || props.busy !== null) {
      return
    }
    setPrompt('')
    props.onSendChat(trimmed, chatMode, useRikugan)
  }

  return (
    <View style={styles.chatContainer}>
      {props.messages.length === 0 ? (
        <Text style={styles.emptyHint}>
          {t(
            'fork.ecosystem.emptyChat',
            'Send a message below — shared live across your Mac, Phone, WhatsApp & Telegram.'
          )}
        </Text>
      ) : (
        <View style={styles.messagesList}>
          {props.messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.msgBubble,
                m.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAssistant
              ]}
            >
              <Text style={styles.msgMeta}>{`${m.sender} · ${m.source}`}</Text>
              <Text style={styles.msgText}>{m.text}</Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={props.busy !== null}
            onPress={props.onClearChat}
            style={styles.clearRow}
          >
            <Trash2 size={12} color={colors.textMuted} />
            <Text style={styles.clearText}>{t('fork.ecosystem.clearChat', 'Clear')}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.modesRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setChatMode('chat')}
          style={[styles.modeChip, chatMode === 'chat' && styles.modeChipActive]}
        >
          <Text style={styles.modeChipText}>{t('fork.ecosystem.modeChat', 'Chat')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setChatMode('review')}
          style={[styles.modeChip, chatMode === 'review' && styles.modeChipActive]}
        >
          <ShieldCheck size={11} color={colors.textPrimary} />
          <Text style={styles.modeChipText}>{t('fork.ecosystem.modeReview', '/review')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setChatMode('learn')}
          style={[styles.modeChip, chatMode === 'learn' && styles.modeChipActive]}
        >
          <Sparkles size={11} color={colors.textPrimary} />
          <Text style={styles.modeChipText}>{t('fork.ecosystem.modeLearn', 'Distill Skill')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setUseRikugan((v) => !v)}
          style={[styles.modeChip, useRikugan && styles.modeChipActive]}
        >
          <Text style={styles.modeChipText}>
            {useRikugan
              ? t('fork.ecosystem.rikuganOn', 'Rikugan: On')
              : t('fork.ecosystem.rikuganOff', 'Rikugan: Off')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder={t('fork.ecosystem.askPlaceholder', 'Message OpenClaw & Hermes on your Mac…')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          editable={props.busy === null}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('fork.ecosystem.sendToMac', 'Send to Mac')}
          disabled={props.busy !== null || prompt.trim().length === 0}
          onPress={handleSend}
          style={[styles.sendBtn, (props.busy !== null || !prompt.trim()) && styles.disabled]}
        >
          {props.busy === 'ask' || props.busy === 'review' || props.busy === 'learn' ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Send size={15} color={colors.background} />
          )}
        </Pressable>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  chatContainer: { gap: spacing.sm },
  emptyHint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  messagesList: { gap: spacing.xs },
  msgBubble: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 2
  },
  msgBubbleUser: { backgroundColor: colors.surfaceElevated, marginLeft: spacing.lg },
  msgBubbleAssistant: { backgroundColor: colors.surface, marginRight: spacing.md },
  msgMeta: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  msgText: { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  clearRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2
  },
  clearText: { fontSize: 11, color: colors.textMuted },
  modesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface
  },
  modeChipActive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.textPrimary
  },
  modeChipText: { fontSize: 11, fontWeight: '600', color: colors.textPrimary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabled: { opacity: 0.45 }
}))
