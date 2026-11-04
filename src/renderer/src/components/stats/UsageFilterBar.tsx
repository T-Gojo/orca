import { Check, ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
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

export function usageRangeLabel(range: UsageRange): string {
  return range === 'all'
    ? translate('auto.components.stats.UsageAccountsSection.allTime', 'All time')
    : range
}

function scopeLabel(scope: UsageScope): string {
  return scope === 'all'
    ? translate('stats.usageFilters.allSessions', 'All sessions')
    : translate('stats.usageFilters.orcaWorkspaces', 'Orca workspaces')
}

/** The one Range and Sessions choice every usage view shows. */
export function UsageFilterBar({ showScope = true }: { showScope?: boolean }): React.JSX.Element {
  const { range, scope, setRange, setScope } = useUsageFilters()
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="usage-filter-bar">
      <ToggleGroup
        type="single"
        size="xs"
        variant="outline"
        value={range}
        aria-label={translate('stats.usageFilters.range', 'Range')}
        onValueChange={(value) => {
          const next = RANGES.find((entry) => entry === value)
          if (next) {
            setRange(next)
          }
        }}
      >
        {RANGES.map((entry) => (
          <ToggleGroupItem key={entry} value={entry}>
            {usageRangeLabel(entry)}
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
              aria-label={translate('stats.usageFilters.sessionsLabel', 'Sessions: {{value}}', {
                value: scopeLabel(scope)
              })}
            >
              {scopeLabel(scope)}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {SCOPES.map((entry) => (
              <DropdownMenuItem key={entry} onSelect={() => setScope(entry)}>
                <span className="flex min-w-0 flex-col">
                  <span>{scopeLabel(entry)}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry === 'all'
                      ? translate(
                          'stats.usageFilters.allSessionsHint',
                          'Every local session, from any app'
                        )
                      : translate(
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
