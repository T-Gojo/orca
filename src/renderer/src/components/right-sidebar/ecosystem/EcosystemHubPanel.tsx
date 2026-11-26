import React, { useState } from 'react'
import { Loader2, QrCode, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useEcosystemHub } from './use-ecosystem-hub'

/** Fork: unified Desktop Ecosystem Hub for Rikugan, OpenClaw (Telegram/WhatsApp), and Hermes Suite (§16). */

export function EcosystemHubPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const {
    status,
    isRefreshing,
    busyAction,
    notice,
    errorText,
    lastAskReply,
    refresh,
    runControl,
    submitAsk,
    runHermes
  } = useEcosystemHub(isVisible)

  const [askText, setAskText] = useState('')
  const [learnTopic, setLearnTopic] = useState('')
  const [tgTokenDraft, setTgTokenDraft] = useState('')
  const [showTgSetup, setShowTgSetup] = useState(false)

  const waChannel = status?.channels.find((ch) => ch.id === 'whatsapp') ?? null

  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
            {t('rightSidebar.ecosystem.title', 'Unified Ecosystem')}
          </span>
          <Badge variant={status?.bridgeRunning ? 'secondary' : 'outline'}>
            {status?.bridgeRunning
              ? t('rightSidebar.ecosystem.badgeOnline', 'Online')
              : t('rightSidebar.ecosystem.badgeStopped', 'Stopped')}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={status?.bridgeRunning ? 'outline' : 'default'}
            size="xs"
            disabled={busyAction !== null}
            onClick={() => runControl(status?.bridgeRunning ? 'sync' : 'up')}
          >
            {busyAction === 'up' || busyAction === 'sync' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {status?.bridgeRunning
              ? t('rightSidebar.ecosystem.syncAll', 'Sync MCPs')
              : t('rightSidebar.ecosystem.startAll', 'Bring Up')}
          </Button>
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            disabled={isRefreshing}
            aria-label={t('rightSidebar.ecosystem.refresh', 'Refresh ecosystem status')}
            onClick={refresh}
          >
            <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {errorText ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-2xs text-destructive"
        >
          {errorText}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-2xs text-foreground"
        >
          {notice}
        </div>
      ) : null}

      <form
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (askText.trim()) {
            submitAsk(askText, false)
            setAskText('')
          }
        }}
      >
        <label htmlFor="eco-ask-input" className="text-2xs font-medium text-foreground">
          {t('rightSidebar.ecosystem.askLabel', 'Ask Orca + Rikugan (One Endpoint)')}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="eco-ask-input"
            type="text"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            placeholder={t(
              'rightSidebar.ecosystem.askPlaceholder',
              'Ask Rikugan, run task on Mac, or review repo…'
            )}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          <Button
            type="submit"
            variant="default"
            size="xs"
            disabled={busyAction !== null || !askText.trim()}
          >
            {busyAction === 'ask' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {t('rightSidebar.ecosystem.send', 'Send')}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-1 pt-0.5">
          <span className="truncate text-2xs text-muted-foreground">
            {status
              ? t('rightSidebar.ecosystem.endpointSummary', '127.0.0.1:{{port}}/v1/ask · {{bot}}', {
                  port: status.bridgePort,
                  bot:
                    status.primaryBotName ?? t('rightSidebar.ecosystem.defaultBotName', 'Orca HQ')
                })
              : t('rightSidebar.ecosystem.endpointDefault', '127.0.0.1:6770/v1/ask')}
          </span>
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            disabled={busyAction !== null}
            onClick={() => runHermes('review', askText.trim() || 'current branch changes')}
          >
            <ShieldCheck className="size-3.5" />
            {t('rightSidebar.ecosystem.reviewBtn', '/review')}
          </Button>
        </div>
        {lastAskReply ? (
          <div className="mt-1 rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-foreground whitespace-pre-wrap">
            {lastAskReply}
          </div>
        ) : null}
      </form>

      {status && status.pendingPairings.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
          <span className="text-2xs font-medium text-foreground">
            {t('rightSidebar.ecosystem.pendingPairings', 'Pending Channel Pairings')}
          </span>
          {status.pendingPairings.map((req) => (
            <div key={req.code} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-mono tabular-nums text-foreground">
                {`${req.code} · ${req.channel} (${req.senderName ?? req.senderId})`}
              </span>
              <Button
                type="button"
                variant="default"
                size="xs"
                disabled={busyAction !== null}
                onClick={() => runControl('approve-pairing', { code: req.code })}
              >
                {t('rightSidebar.ecosystem.approve', 'Approve')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {t('rightSidebar.ecosystem.rikuganTitle', 'Rikugan Personal Brain (Mac SSD)')}
          </span>
          <Badge variant={status?.rikugan.state === 'online' ? 'secondary' : 'outline'}>
            {status?.rikugan.state ?? t('rightSidebar.ecosystem.loadingEllipsis', '…')}
          </Badge>
        </div>
        <p className="text-2xs text-muted-foreground">
          {status?.rikugan.detail ??
            t('rightSidebar.ecosystem.rikuganChecking', 'Checking 127.0.0.1:5680…')}
        </p>
        {status?.rikugan.embeddedChunks !== null && status?.rikugan.embeddedChunks !== undefined ? (
          <p className="text-2xs text-muted-foreground tabular-nums">
            {t(
              'rightSidebar.ecosystem.rikuganVectors',
              '{{vectors}} semantic vectors · {{sessions}} recorded sessions',
              {
                vectors: status.rikugan.embeddedChunks.toLocaleString(intlLocale),
                sessions: status.rikugan.recordedSessions
              }
            )}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {t('rightSidebar.ecosystem.openclawTitle', 'OpenClaw Channels & Multimodal')}
          </span>
          {status?.bridgeRunning ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="xs"
              disabled={busyAction !== null}
              onClick={() => runControl('down')}
            >
              {t('rightSidebar.ecosystem.stopBridge', 'Stop')}
            </Button>
          ) : null}
        </div>

        {(status?.channels ?? []).map((ch) => (
          <div
            key={ch.id}
            className="flex flex-col gap-1 border-t border-border/50 pt-2 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{ch.label}</span>
              <Badge variant={ch.state === 'online' ? 'secondary' : 'outline'}>{ch.state}</Badge>
            </div>
            <p className="text-2xs text-muted-foreground">{ch.detail}</p>
            {ch.id === 'telegram' ? (
              <div className="flex items-center gap-1 pt-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setShowTgSetup((v) => !v)}
                >
                  {t('rightSidebar.ecosystem.configureToken', 'Set Bot Token')}
                </Button>
              </div>
            ) : null}
            {ch.id === 'whatsapp' ? (
              <div className="flex items-center gap-1 pt-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busyAction !== null}
                  onClick={() => runControl('whatsapp-login')}
                >
                  <QrCode className="size-3.5" />
                  {t('rightSidebar.ecosystem.pairWhatsApp', 'Pair WhatsApp QR')}
                </Button>
                {ch.state === 'online' ? (
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="xs"
                    disabled={busyAction !== null}
                    onClick={() => runControl('whatsapp-logout')}
                  >
                    {t('rightSidebar.ecosystem.logout', 'Disconnect')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}

        {showTgSetup ? (
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="password"
              aria-label={t('rightSidebar.ecosystem.tgTokenLabel', 'Telegram bot token')}
              value={tgTokenDraft}
              onChange={(e) => setTgTokenDraft(e.target.value)}
              placeholder={t(
                'rightSidebar.ecosystem.tgTokenPlaceholder',
                'Bot token from BotFather'
              )}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            />
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={!tgTokenDraft.trim() || busyAction !== null}
              onClick={() => {
                runControl('set-telegram-token', { token: tgTokenDraft })
                setTgTokenDraft('')
                setShowTgSetup(false)
              }}
            >
              {t('rightSidebar.ecosystem.saveToken', 'Save')}
            </Button>
          </div>
        ) : null}

        {waChannel?.qrDataUrl ? (
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-muted/20 p-2">
            <img
              src={waChannel.qrDataUrl}
              alt={t('rightSidebar.ecosystem.waQrAlt', 'WhatsApp Linked Devices QR code')}
              className="size-44 rounded bg-white p-1"
            />
            <span className="text-center text-2xs text-muted-foreground">
              {t(
                'rightSidebar.ecosystem.waQrHint',
                'Open WhatsApp on your phone › Linked Devices › Link a Device'
              )}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {t('rightSidebar.ecosystem.hermesTitle', 'Hermes Intelligence Suite')}
          </span>
          <Button
            type="button"
            variant={status?.hermes.autoLearnEnabled ? 'secondary' : 'outline'}
            size="xs"
            disabled={busyAction !== null}
            onClick={() => runControl('toggle-auto-learn')}
          >
            {status?.hermes.autoLearnEnabled
              ? t('rightSidebar.ecosystem.autoLearnOn', 'Auto-Learn: On')
              : t('rightSidebar.ecosystem.autoLearnOff', 'Auto-Learn: Paused')}
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">
          {status?.hermes.detail ??
            t(
              'rightSidebar.ecosystem.hermesDefaultDetail',
              'PTC · /review · Skills Hub · Silent Learning'
            )}
        </p>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            aria-label={t('rightSidebar.ecosystem.learnInputLabel', 'Skill topic to distill')}
            value={learnTopic}
            onChange={(e) => setLearnTopic(e.target.value)}
            placeholder={t('rightSidebar.ecosystem.learnPlaceholder', 'Distill skill topic…')}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={!learnTopic.trim() || busyAction !== null}
            onClick={() => {
              runHermes('learn', learnTopic)
              setLearnTopic('')
            }}
          >
            <Sparkles className="size-3.5" />
            {t('rightSidebar.ecosystem.learnBtn', 'Distill')}
          </Button>
        </div>

        {(status?.hermes.recentLearnedSkills ?? []).slice(0, 4).map((entry) => (
          <div
            key={entry.backupId}
            className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-2xs"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-foreground">{entry.skillName}</div>
              <div className="truncate text-muted-foreground">{entry.description}</div>
            </div>
            <Button
              type="button"
              variant="ghost-muted"
              size="xs"
              disabled={busyAction !== null}
              onClick={() => runControl('undo-skill', { skillName: entry.backupId })}
            >
              <RotateCcw className="size-3" />
              {t('rightSidebar.ecosystem.undo', 'Undo')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
