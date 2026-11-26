import React, { useEffect } from 'react'
import { Loader2, Radio, RefreshCw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useEcosystemHub } from '../right-sidebar/ecosystem/use-ecosystem-hub'
import { EcosystemChatPane } from './EcosystemChatPane'
import { EcosystemSetupAndHermesPane } from './EcosystemSetupAndHermesPane'
import { closeEcosystemPage, useEcosystemPageOpen } from './ecosystem-page-store'

/** Fork: full-workspace OpenClaw & Hermes Unified Chat + Setup surface in Orca Desktop (§16). */

export default function EcosystemWorkspacePage(): React.JSX.Element | null {
  const isOpen = useEcosystemPageOpen()
  const t = useTranslate()
  const {
    status,
    isRefreshing,
    busyAction,
    notice,
    errorText,
    skillResults,
    refresh,
    runControl,
    submitAsk,
    runHermes
  } = useEcosystemHub(isOpen)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeEcosystemPage()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Radio className="size-4 shrink-0 text-foreground" />
          <h1 className="truncate text-sm font-semibold text-foreground">
            {t('ecosystem.page.title', 'OpenClaw & Hermes Hub')}
          </h1>
          <Badge variant={status?.bridgeRunning ? 'secondary' : 'outline'}>
            {status?.bridgeRunning
              ? t('rightSidebar.ecosystem.badgeOnline', 'Online')
              : t('rightSidebar.ecosystem.badgeStopped', 'Stopped')}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('ecosystem.page.close', 'Close OpenClaw & Hermes Hub')}
            onClick={closeEcosystemPage}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {errorText ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
        >
          {errorText}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-foreground"
        >
          {notice}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <EcosystemChatPane
          messages={status?.chatMessages ?? []}
          busyAction={busyAction}
          bridgePort={status?.bridgePort ?? 6770}
          primaryBotName={status?.primaryBotName ?? null}
          onSendAsk={(prompt, useRikugan) => submitAsk(prompt, true, useRikugan)}
          onRunHermes={(mode, value) => runHermes(mode, value)}
          onClearChat={() => runControl('clear-chat')}
          onNotifyPhone={(message) => runControl('notify', { message, channel: 'auto' })}
        />
        <EcosystemSetupAndHermesPane
          status={status}
          busyAction={busyAction}
          skillResults={skillResults}
          onControl={runControl}
          onSearchSkills={(q) => runHermes('skills-search', q)}
          onInstallSkill={(target) => runHermes('skills-install', target)}
        />
      </div>
    </div>
  )
}
