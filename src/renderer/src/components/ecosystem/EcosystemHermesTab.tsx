import React, { useState } from 'react'
import { Download, RotateCcw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import type {
  EcosystemControlAction,
  EcosystemStatusSnapshot
} from '../../../../shared/ecosystem/ecosystem-types'
import type { SkillHubItem } from '../right-sidebar/ecosystem/use-ecosystem-hub'

/** Fork: Hermes Intelligence Suite & On-Demand Rikugan inspector tab inside Desktop Hub (§16). */

export function EcosystemHermesTab(props: {
  status: EcosystemStatusSnapshot | null
  busyAction: string | null
  skillResults: readonly SkillHubItem[]
  onControl: (action: EcosystemControlAction, payload?: { skillName?: string }) => void
  onSearchSkills: (query: string) => void
  onInstallSkill: (nameOrUrl: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [skillQuery, setSkillQuery] = useState('')

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t('rightSidebar.ecosystem.hermesTitle', 'Hermes Intelligence Suite')}
          </span>
          <Button
            type="button"
            variant={props.status?.hermes.autoLearnEnabled ? 'secondary' : 'outline'}
            size="xs"
            disabled={props.busyAction !== null}
            onClick={() => props.onControl('toggle-auto-learn')}
          >
            {props.status?.hermes.autoLearnEnabled
              ? t('rightSidebar.ecosystem.autoLearnOn', 'Auto-Learn: On')
              : t('rightSidebar.ecosystem.autoLearnOff', 'Auto-Learn: Paused')}
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">
          {props.status?.hermes.detail ??
            t(
              'rightSidebar.ecosystem.hermesDefaultDetail',
              'PTC · /review · Skills Hub · Silent Learning'
            )}
        </p>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (skillQuery.trim() && props.busyAction === null) {
              props.onSearchSkills(skillQuery.trim())
            }
          }}
        >
          <input
            type="text"
            aria-label={t('ecosystem.hermes.searchLabel', 'Search Hermes Skills Hub')}
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            placeholder={t(
              'ecosystem.hermes.searchPlaceholder',
              'Search 1,426+ local & GitHub skills…'
            )}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          <Button
            type="submit"
            variant="secondary"
            size="xs"
            disabled={!skillQuery.trim() || props.busyAction !== null}
          >
            <Search className="size-3.5" />
            {t('ecosystem.hermes.searchBtn', 'Search')}
          </Button>
        </form>

        {props.skillResults.slice(0, 6).map((item) => (
          <div
            key={`${item.source}:${item.name}`}
            className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-2xs"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono font-medium text-foreground">{item.name}</div>
              <div className="truncate text-muted-foreground">{item.description}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={props.busyAction !== null}
              onClick={() => props.onInstallSkill(item.url ?? item.name)}
            >
              <Download className="size-3" />
              {t('ecosystem.hermes.installBtn', 'Install')}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <span className="text-xs font-semibold text-foreground">
          {t('ecosystem.hermes.learnedHeading', 'Auto-Learned Skills (1-Tap Undo)')}
        </span>
        {(props.status?.hermes.recentLearnedSkills ?? []).length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            {t(
              'ecosystem.hermes.noLearnedYet',
              'Skills distilled by Hermes appear here with instant rollback across all 6 CLIs.'
            )}
          </p>
        ) : (
          (props.status?.hermes.recentLearnedSkills ?? []).map((entry) => (
            <div
              key={entry.backupId}
              className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-2xs first:border-t-0 first:pt-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-foreground">{entry.skillName}</div>
                <div className="truncate text-muted-foreground">{entry.description}</div>
              </div>
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                disabled={props.busyAction !== null}
                onClick={() => props.onControl('undo-skill', { skillName: entry.backupId })}
              >
                <RotateCcw className="size-3" />
                {t('rightSidebar.ecosystem.undo', 'Undo')}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t('ecosystem.hermes.rikuganCardTitle', 'Rikugan Personal Brain (On-Demand)')}
          </span>
          <Badge variant={props.status?.rikugan.state === 'online' ? 'secondary' : 'outline'}>
            {props.status?.rikugan.state ?? t('rightSidebar.ecosystem.loadingEllipsis', '…')}
          </Badge>
        </div>
        <p className="text-2xs text-muted-foreground">
          {props.status?.rikugan.detail ??
            t('rightSidebar.ecosystem.rikuganChecking', 'Checking 127.0.0.1:5680…')}
        </p>
        {props.status?.rikugan.embeddedChunks !== null &&
        props.status?.rikugan.embeddedChunks !== undefined ? (
          <p className="text-2xs text-muted-foreground tabular-nums">
            {t(
              'rightSidebar.ecosystem.rikuganVectors',
              '{{vectors}} semantic vectors · {{sessions}} recorded sessions',
              {
                vectors: props.status.rikugan.embeddedChunks.toLocaleString(intlLocale),
                sessions: props.status.rikugan.recordedSessions
              }
            )}
          </p>
        ) : null}
      </div>
    </>
  )
}
