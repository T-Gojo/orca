import { Check, ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { useUsageFilters, type UsageRange, type UsageScope } from './use-usage-filters'

const RANGES: readonly UsageRange[] = ['7d', '30d', '90d', 'all']
const SCOPES: readonly UsageScope[] = ['all', 'orca']

export function usageRangeLabel(range: UsageRange, t: Translate = translate): string {
  return range === 'all'
    ? t('auto.components.stats.UsageAccountsSection.allTime', 'All time')
    : range
}

function scopeLabel(scope: UsageScope, t: Translate = translate): string {
  return scope === 'all'
    ? t('stats.usageFilters.allSessions', 'All sessions')
    : t('stats.usageFilters.orcaWorkspaces', 'Orca workspaces')
}

/** The one Range and Sessions choice every usage view shows. */
export function UsageFilterBar({ showScope = true }: { showScope?: boolean }): React.JSX.Element {
  const t = useTranslate()
  const { range, scope, setRange, setScope } = useUsageFilters()
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="usage-filter-bar">
      <ToggleGroup
        type="single"
        size="xs"
        variant="outline"
        value={range}
        aria-label={t('stats.usageFilters.range', 'Range')}
        onValueChange={(value) => {
          const next = RANGES.find((entry) => entry === value)
          if (next) {
            setRange(next)
          }
        }}
      >
        {RANGES.map((entry) => (
          <ToggleGroupItem key={entry} value={entry}>
            {usageRangeLabel(entry, t)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {showScope ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={t('stats.usageFilters.sessionsLabel', 'Sessions: {{value}}', {
                value: scopeLabel(scope, t)
              })}
            >
              {scopeLabel(scope, t)}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {SCOPES.map((entry) => (
              <DropdownMenuItem key={entry} onSelect={() => setScope(entry)}>
                <span className="flex min-w-0 flex-col">
                  <span>{scopeLabel(entry, t)}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry === 'all'
                      ? t('stats.usageFilters.allSessionsHint', 'Every local session, from any app')
                      : t(
                          'stats.usageFilters.orcaWorkspacesHint',
                          'Only sessions in your Orca workspaces'
                        )}
                  </span>
                </span>
                <Check
                  className={`ml-auto size-3.5 ${scope === entry ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
