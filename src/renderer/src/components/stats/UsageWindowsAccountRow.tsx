import { useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import {
  SYSTEM_DEFAULT_ACCOUNT_KEY,
  UNATTRIBUTED_ACCOUNT_KEY
} from '../../../../shared/account-usage-ledger-types'
import type {
  AccountUsageRemoveTarget,
  AccountUsageWindowRow
} from '../../../../shared/account-usage-windows-types'
import { formatUsageTokens } from './usage-overview-model'
import { usageRemoveKey } from './use-account-usage-windows'

// Fork: collapsible per-account row with per-model token breakdown and inline remove (FORK.md §12).

function accountLabel(row: AccountUsageWindowRow, t: Translate): string {
  if (row.accountKey === UNATTRIBUTED_ACCOUNT_KEY) {
    return t('stats.usageAccounts.earlierUsage', 'Earlier usage')
  }
  if (row.accountKey === SYSTEM_DEFAULT_ACCOUNT_KEY && !row.label) {
    return t('auto.components.status.bar.StatusBar.c676918adc', 'System default')
  }
  return (
    row.label ?? t('auto.components.stats.UsageAccountsSection.unknownAccount', 'Saved account')
  )
}

function formatWindowTokens(value: number, estimated: boolean, intlLocale: string): string {
  if (value <= 0) {
    return '—'
  }
  return `${estimated ? '≈' : ''}${formatUsageTokens(value, intlLocale)}`
}

export function UsageWindowsAccountRow({
  row,
  removingKey,
  onRemove
}: {
  row: AccountUsageWindowRow
  removingKey: string | null
  onRemove: (target: AccountUsageRemoveTarget) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const [open, setOpen] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const label = accountLabel(row, t)
  const accountTarget: AccountUsageRemoveTarget = {
    provider: row.provider,
    accountKey: row.accountKey
  }
  const accountRemoveId = usageRemoveKey(accountTarget)
  const isRemovingAccount = removingKey === accountRemoveId

  return (
    <div className="py-1.5" data-testid="usage-windows-account-row">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-xs hover:bg-foreground/5"
            >
              <ChevronRight
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
              />
              <span
                className={`min-w-0 truncate ${
                  row.accountKey === UNATTRIBUTED_ACCOUNT_KEY
                    ? 'text-muted-foreground'
                    : 'text-foreground'
                }`}
              >
                {label}
              </span>
              {row.removed ? (
                <Badge variant="outline" className="shrink-0">
                  {t('auto.components.stats.UsageAccountsSection.removed', 'Removed')}
                </Badge>
              ) : null}
              <span className="ml-auto w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatWindowTokens(row.inputTokens, row.estimated, intlLocale)}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatWindowTokens(row.outputTokens, row.estimated, intlLocale)}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatWindowTokens(row.cacheTokens, row.estimated, intlLocale)}
              </span>
              <span className="w-18 shrink-0 text-right tabular-nums font-medium text-foreground">
                {formatWindowTokens(row.totalTokens, row.estimated, intlLocale)}
              </span>
            </button>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-1">
            {confirmKey === 'account' ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  disabled={isRemovingAccount}
                  onClick={() => {
                    setConfirmKey(null)
                    onRemove(accountTarget)
                  }}
                >
                  {t('stats.usageWindows.confirmRemove', 'Remove')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isRemovingAccount}
                  onClick={() => setConfirmKey(null)}
                >
                  {t('stats.usageWindows.cancelRemove', 'Cancel')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                disabled={isRemovingAccount}
                aria-label={t(
                  'stats.usageWindows.removeAccount',
                  'Remove stored usage for {{account}}',
                  { account: label }
                )}
                onClick={() => setConfirmKey('account')}
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="mt-1 space-y-0.5 border-l border-border/60 pl-5">
            {row.models.map((entry) => {
              const modelTarget: AccountUsageRemoveTarget = {
                provider: row.provider,
                accountKey: row.accountKey,
                model: entry.model
              }
              const modelKey = `model:${entry.model}`
              const isRemovingModel = removingKey === usageRemoveKey(modelTarget)
              return (
                <div
                  key={entry.model}
                  className="flex min-w-0 items-center gap-2 py-1 text-2xs"
                  data-testid="usage-windows-model-row"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    {entry.model}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {formatWindowTokens(entry.inputTokens, entry.estimated, intlLocale)}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {formatWindowTokens(entry.outputTokens, entry.estimated, intlLocale)}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {formatWindowTokens(entry.cacheTokens, entry.estimated, intlLocale)}
                  </span>
                  <span className="w-18 shrink-0 text-right tabular-nums text-foreground">
                    {formatWindowTokens(entry.totalTokens, entry.estimated, intlLocale)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmKey === modelKey ? (
                      <>
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          disabled={isRemovingModel}
                          onClick={() => {
                            setConfirmKey(null)
                            onRemove(modelTarget)
                          }}
                        >
                          {t('stats.usageWindows.confirmRemove', 'Remove')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={isRemovingModel}
                          onClick={() => setConfirmKey(null)}
                        >
                          {t('stats.usageWindows.cancelRemove', 'Cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="icon-xs"
                        disabled={isRemovingModel}
                        aria-label={t(
                          'stats.usageWindows.removeModel',
                          'Remove stored usage for {{model}}',
                          { model: entry.model }
                        )}
                        onClick={() => setConfirmKey(modelKey)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
