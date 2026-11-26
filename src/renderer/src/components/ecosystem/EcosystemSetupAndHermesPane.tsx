import React, { useState } from 'react'
import { Loader2, QrCode, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import type {
  EcosystemControlAction,
  EcosystemStatusSnapshot
} from '../../../../shared/ecosystem/ecosystem-types'
import type { SkillHubItem } from '../right-sidebar/ecosystem/use-ecosystem-hub'
import { EcosystemHermesTab } from './EcosystemHermesTab'
import { closeEcosystemPage } from './ecosystem-page-store'

/** Fork: right-hand Setup (Phone + WhatsApp + Telegram) & Hermes Suite inspector (§16). */

export function EcosystemSetupAndHermesPane(props: {
  status: EcosystemStatusSnapshot | null
  busyAction: string | null
  skillResults: readonly SkillHubItem[]
  onControl: (
    action: EcosystemControlAction,
    payload?: {
      code?: string
      token?: string
      skillName?: string
      message?: string
      channel?: 'auto' | 'telegram' | 'whatsapp'
    }
  ) => void
  onSearchSkills: (query: string) => void
  onInstallSkill: (nameOrUrl: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const openMobilePage = useAppStore((s) => s.openMobilePage)

  const [tab, setTab] = useState<'setup' | 'hermes'>('setup')
  const [tgToken, setTgToken] = useState('')
  const [pairCode, setPairCode] = useState('')

  const tgChannel = props.status?.channels.find((c) => c.id === 'telegram') ?? null
  const waChannel = props.status?.channels.find((c) => c.id === 'whatsapp') ?? null

  return (
    <div className="flex w-full shrink-0 flex-col bg-background lg:w-[390px]">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant={tab === 'setup' ? 'secondary' : 'ghost-muted'}
          size="xs"
          onClick={() => setTab('setup')}
        >
          {t('ecosystem.setup.tabChannels', 'Phone · WhatsApp · Telegram')}
        </Button>
        <Button
          type="button"
          variant={tab === 'hermes' ? 'secondary' : 'ghost-muted'}
          size="xs"
          onClick={() => setTab('hermes')}
        >
          {t('ecosystem.setup.tabHermes', 'Hermes Suite & Skills')}
        </Button>
      </div>

      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {tab === 'setup' ? (
          <>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t('ecosystem.setup.phoneTitle', '1. Connect Orca Mobile App')}
                </span>
                <Smartphone className="size-4 text-muted-foreground" />
              </div>
              <p className="text-2xs text-muted-foreground">
                {t(
                  'ecosystem.setup.phoneDesc',
                  'Scan the desktop pairing QR from the Orca app on your Android phone to chat and configure WhatsApp & Telegram remotely.'
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  closeEcosystemPage()
                  openMobilePage()
                }}
              >
                <QrCode className="size-3.5" />
                {t('ecosystem.setup.openPhoneQr', 'Show Phone Pairing QR')}
              </Button>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t('ecosystem.setup.whatsappTitle', '2. OpenClaw WhatsApp')}
                </span>
                <Badge variant={waChannel?.state === 'online' ? 'secondary' : 'outline'}>
                  {waChannel?.state ?? t('rightSidebar.ecosystem.badgeStopped', 'Stopped')}
                </Badge>
              </div>
              <p className="text-2xs text-muted-foreground">
                {waChannel?.detail ??
                  t(
                    'ecosystem.setup.whatsappDefault',
                    'Multi-device Baileys link (Note-to-Self + approved contacts).'
                  )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  disabled={props.busyAction !== null}
                  onClick={() => props.onControl('whatsapp-login')}
                >
                  {props.busyAction === 'whatsapp-login' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <QrCode className="size-3.5" />
                  )}
                  {t('ecosystem.setup.generateWaQr', 'Generate WhatsApp QR')}
                </Button>
                {waChannel?.state === 'online' ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={props.busyAction !== null}
                      onClick={() =>
                        props.onControl('notify', {
                          channel: 'whatsapp',
                          message: t(
                            'ecosystem.setup.waTestMsg',
                            'Orca OpenClaw WhatsApp link is live.'
                          )
                        })
                      }
                    >
                      {t('ecosystem.setup.sendTest', 'Send Test')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="xs"
                      disabled={props.busyAction !== null}
                      onClick={() => props.onControl('whatsapp-logout')}
                    >
                      {t('rightSidebar.ecosystem.logout', 'Disconnect')}
                    </Button>
                  </>
                ) : null}
              </div>
              {waChannel?.qrDataUrl ? (
                <div className="mt-1 flex flex-col items-center gap-1.5 rounded-md border border-border bg-muted/30 p-2.5">
                  <img
                    src={waChannel.qrDataUrl}
                    alt={t('rightSidebar.ecosystem.waQrAlt', 'WhatsApp Linked Devices QR code')}
                    className="size-48 rounded bg-white p-1.5"
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

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {t('ecosystem.setup.telegramTitle', '3. OpenClaw Telegram & Pairing')}
                </span>
                <Badge variant={tgChannel?.state === 'online' ? 'secondary' : 'outline'}>
                  {tgChannel?.botUsername ??
                    tgChannel?.state ??
                    t('rightSidebar.ecosystem.badgeStopped', 'Stopped')}
                </Badge>
              </div>
              <p className="text-2xs text-muted-foreground">
                {tgChannel?.detail ??
                  t(
                    'ecosystem.setup.telegramDefault',
                    'Paste a @BotFather token, then DM your bot and approve its 6-digit pairing code.'
                  )}
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  aria-label={t('rightSidebar.ecosystem.tgTokenLabel', 'Telegram bot token')}
                  value={tgToken}
                  onChange={(e) => setTgToken(e.target.value)}
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
                  disabled={!tgToken.trim() || props.busyAction !== null}
                  onClick={() => {
                    props.onControl('set-telegram-token', { token: tgToken.trim() })
                    setTgToken('')
                  }}
                >
                  {t('ecosystem.setup.saveAndStart', 'Save & Connect')}
                </Button>
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  aria-label={t('ecosystem.setup.pairCodeLabel', '6-digit DM pairing code')}
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                  placeholder={t('ecosystem.setup.pairCodePlaceholder', '6-digit pairing code…')}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!pairCode.trim() || props.busyAction !== null}
                  onClick={() => {
                    props.onControl('approve-pairing', { code: pairCode.trim() })
                    setPairCode('')
                  }}
                >
                  {t('rightSidebar.ecosystem.approve', 'Approve')}
                </Button>
                {tgChannel?.state === 'online' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={props.busyAction !== null}
                    onClick={() =>
                      props.onControl('notify', {
                        channel: 'telegram',
                        message: t(
                          'ecosystem.setup.tgTestMsg',
                          'Orca OpenClaw Telegram bot is live.'
                        )
                      })
                    }
                  >
                    {t('ecosystem.setup.sendTest', 'Send Test')}
                  </Button>
                ) : null}
              </div>

              {(props.status?.pendingPairings ?? []).map((req) => (
                <div
                  key={req.code}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate font-mono tabular-nums text-foreground">
                    {`${req.code} · ${req.channel} (${req.senderName ?? req.senderId})`}
                  </span>
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    disabled={props.busyAction !== null}
                    onClick={() => props.onControl('approve-pairing', { code: req.code })}
                  >
                    {t('rightSidebar.ecosystem.approve', 'Approve')}
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EcosystemHermesTab
            status={props.status}
            busyAction={props.busyAction}
            skillResults={props.skillResults}
            onControl={props.onControl}
            onSearchSkills={props.onSearchSkills}
            onInstallSkill={props.onInstallSkill}
          />
        )}
      </div>
    </div>
  )
}
