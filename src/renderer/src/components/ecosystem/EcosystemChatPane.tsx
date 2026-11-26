import React, { useEffect, useRef, useState } from 'react'
import { Database, Loader2, MessageSquare, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { isImeOwnedKeyboardEvent } from '@/lib/text-input/ime/ime-composition-keyboard-event'
import type { EcosystemChatMessage } from '../../../../shared/ecosystem/ecosystem-types'

/** Fork: unified multi-surface conversation pane (Desktop + Phone + WhatsApp + Telegram + Hermes) (§16). */

type ComposerMode = 'chat' | 'review' | 'learn'

export function EcosystemChatPane(props: {
  messages: readonly EcosystemChatMessage[]
  busyAction: string | null
  bridgePort: number
  primaryBotName: string | null
  onSendAsk: (prompt: string, useRikugan: boolean) => void
  onRunHermes: (mode: 'learn' | 'review', value: string) => void
  onClearChat: () => void
  onNotifyPhone: (text: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ComposerMode>('chat')
  const [useRikugan, setUseRikugan] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [props.messages.length])

  const handleSubmit = () => {
    const trimmed = draft.trim()
    if (!trimmed || props.busyAction !== null) {
      return
    }
    if (mode === 'review') {
      props.onRunHermes('review', trimmed)
    } else if (mode === 'learn') {
      props.onRunHermes('learn', trimmed)
    } else {
      props.onSendAsk(trimmed, useRikugan)
    }
    setDraft('')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-foreground">
            {t('ecosystem.chat.heading', 'Unified Chat · OpenClaw · Hermes · Orca')}
          </span>
          <Badge variant="outline">
            {t('ecosystem.chat.endpointBadge', '127.0.0.1:{{port}}', { port: props.bridgePort })}
          </Badge>
        </div>
        {props.messages.length > 0 ? (
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            disabled={props.busyAction !== null}
            onClick={props.onClearChat}
          >
            <Trash2 className="size-3.5" />
            {t('ecosystem.chat.clear', 'Clear')}
          </Button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
      >
        {props.messages.length === 0 ? (
          <div className="my-auto mx-auto flex max-w-lg flex-col gap-3 py-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-foreground">
                {t(
                  'ecosystem.chat.emptyTitle',
                  'One conversation across Mac, Phone, WhatsApp, Telegram & Hermes'
                )}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t(
                  'ecosystem.chat.emptySubtitle',
                  'Messages sent here, from Orca Mobile, or from paired WhatsApp / Telegram appear in this shared stream. Rikugan stays off unless you toggle it on.'
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setMode('review')
                  setDraft('current repository changes and security invariants')
                }}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium text-foreground">
                  {t('ecosystem.chat.starterReviewTitle', 'Run Hermes /review')}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t(
                    'ecosystem.chat.starterReviewDesc',
                    'Independent senior code & security review'
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('learn')
                  setDraft('Thunder SSD cache and Orca fork workflow')
                }}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium text-foreground">
                  {t('ecosystem.chat.starterLearnTitle', 'Distill a Hermes Skill')}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t(
                    'ecosystem.chat.starterLearnDesc',
                    'Create a <=60-char SKILL.md across all 6 CLIs'
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('chat')
                  setUseRikugan(false)
                  setDraft('Summarize active capabilities across OpenClaw, Hermes, and Orca.')
                }}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium text-foreground">
                  {t('ecosystem.chat.starterAskTitle', 'Chat with OpenClaw & Orca')}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t(
                    'ecosystem.chat.starterAskDesc',
                    'Fast direct response without touching Rikugan'
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('chat')
                  setUseRikugan(true)
                  setDraft('Check Rikugan for my recent projects and open threads.')
                }}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-xs font-medium text-foreground">
                  {t('ecosystem.chat.starterRikuganTitle', 'Query Rikugan (On-Demand)')}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t('ecosystem.chat.starterRikuganDesc', 'Explicitly pull personal memory once')}
                </span>
              </button>
            </div>
          </div>
        ) : (
          props.messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex max-w-[85%] flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-xs',
                msg.role === 'user'
                  ? 'ml-auto border-border bg-muted/60 text-foreground'
                  : 'mr-auto border-border bg-card text-foreground'
              )}
            >
              <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">{msg.sender}</span>
                <Badge variant="outline">{msg.source}</Badge>
                {msg.rikuganUsed ? (
                  <Badge variant="secondary">{t('ecosystem.chat.rikuganTag', 'Rikugan')}</Badge>
                ) : null}
                <span className="tabular-nums">
                  {new Date(msg.at).toLocaleTimeString(intlLocale, {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-card/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant={mode === 'chat' ? 'secondary' : 'ghost-muted'}
              size="xs"
              onClick={() => setMode('chat')}
            >
              <MessageSquare className="size-3.5" />
              {t('ecosystem.chat.modeChat', 'Chat')}
            </Button>
            <Button
              type="button"
              variant={mode === 'review' ? 'secondary' : 'ghost-muted'}
              size="xs"
              onClick={() => setMode('review')}
            >
              <ShieldCheck className="size-3.5" />
              {t('ecosystem.chat.modeReview', 'Hermes /review')}
            </Button>
            <Button
              type="button"
              variant={mode === 'learn' ? 'secondary' : 'ghost-muted'}
              size="xs"
              onClick={() => setMode('learn')}
            >
              <Sparkles className="size-3.5" />
              {t('ecosystem.chat.modeLearn', 'Distill Skill')}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={useRikugan ? 'secondary' : 'outline'}
              size="xs"
              aria-pressed={useRikugan}
              onClick={() => setUseRikugan((v) => !v)}
            >
              <Database className="size-3.5" />
              {useRikugan
                ? t('ecosystem.chat.rikuganOn', 'Rikugan: On')
                : t('ecosystem.chat.rikuganOff', 'Rikugan: Off')}
            </Button>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={draft}
            aria-label={t('ecosystem.chat.inputLabel', 'Message OpenClaw, Hermes, and Orca')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isImeOwnedKeyboardEvent(e)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={
              mode === 'review'
                ? t('ecosystem.chat.placeholderReview', 'Describe branch, PR, or files to review…')
                : mode === 'learn'
                  ? t(
                      'ecosystem.chat.placeholderLearn',
                      'Describe the workflow topic to distill into a SKILL.md…'
                    )
                  : t(
                      'ecosystem.chat.placeholderChat',
                      'Message OpenClaw + Hermes + Orca (Enter to send, Shift+Enter for newline)…'
                    )
            }
            className="scrollbar-sleek min-h-[52px] max-h-36 min-w-0 flex-1 resize-y rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={props.busyAction !== null || !draft.trim()}
              onClick={handleSubmit}
            >
              {props.busyAction === 'ask' ||
              props.busyAction === 'review' ||
              props.busyAction === 'learn' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t('ecosystem.chat.sendBtn', 'Send')}
            </Button>
            {draft.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={props.busyAction !== null}
                onClick={() => {
                  props.onNotifyPhone(draft.trim())
                  setDraft('')
                }}
              >
                {t('ecosystem.chat.pushToPhone', 'Push to Phone')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
