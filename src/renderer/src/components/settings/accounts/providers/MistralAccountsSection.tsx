import { runGuardedAccountAction } from './account-action-guard'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import {
  callMistralAccounts,
  type MistralAccountAction
} from '@/runtime/runtime-mistral-accounts-client'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { MistralAccountState } from '../../../../../../shared/mistral-account-types'
import type {
  RateLimitState,
  SavedAccountUsage
} from '../../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { Button } from '../../../ui/button'
import { Badge } from '../../../ui/badge'
import { useAppStore } from '../../../../store'

// Fork: Mistral Vibe accounts (FORK.md section 10) are pin-mode — no Switch button and no sign-in
// flow: the section saves the in-use API key, removes saved ones, and reads usage per account.
function usageLine(t: Translate, usage: SavedAccountUsage | undefined): string | null {
  const limits = usage?.rateLimits
  if (!limits) {
    return null
  }
  if (limits.monthly) {
    const used = t('accounts.mistral.quotaUsed', 'Vibe quota: {{percent}}% used', {
      percent: Math.round(limits.monthly.usedPercent)
    })
    return limits.planType ? `${used} · ${limits.planType}` : used
  }
  return limits.error
}

export function MistralAccountsSection({
  owner,
  label
}: {
  owner: RuntimeClientTarget
  label: string
}): React.JSX.Element {
  const t = useTranslate()
  const [state, setState] = useState<MistralAccountState | null>(null)
  const [fetchedUsage, setFetchedUsage] = useState<SavedAccountUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const ownerKind = owner.kind
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  const localUsage = useAppStore((s) => s.rateLimits.mistralAccounts)
  const usage = fetchedUsage ?? (ownerKind === 'local' ? localUsage : undefined)

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const currentOwner: RuntimeClientTarget =
      ownerKind === 'environment' && environmentId
        ? { kind: 'environment', environmentId }
        : { kind: 'local' }
    void callMistralAccounts(currentOwner, 'List').then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Mistral accounts could not be loaded.')
        }
      }
    )
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [ownerKind, environmentId])

  async function run(action: MistralAccountAction | 'Usage', accountId?: string): Promise<void> {
    await runGuardedAccountAction(pending, mounted, setBusy, async () => {
      setError(null)
      try {
        if (action === 'Usage') {
          const snapshot = await callRuntimeRpc<{ rateLimits: RateLimitState }>(
            owner,
            'accounts.list',
            { refreshUsage: true }
          )
          const next = await callMistralAccounts(owner, 'List')
          if (mounted.current) {
            setFetchedUsage(snapshot.rateLimits.mistralAccounts ?? [])
            setState(next)
          }
          return
        }
        const next = await callMistralAccounts(owner, action, accountId)
        if (mounted.current) {
          setState(next)
        }
      } catch (cause) {
        if (action !== 'List') {
          const observed = await callMistralAccounts(owner, 'List').catch(() => null)
          if (mounted.current && observed) {
            setState(observed)
          }
        }
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : 'Mistral account action failed.')
        }
      }
    })
  }

  const currentFingerprint = state?.currentAccount?.keyFingerprint ?? null

  return (
    <section id="accounts-mistral" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AgentIcon agent="mistral-vibe" size={16} />
          {t('accounts.mistral.title', 'Mistral Vibe')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'accounts.mistral.scope',
            'Save a Mistral Vibe API key per account on {{host}}. Picking an account uses it for the next Mistral Vibe terminal you start.',
            { host: label }
          )}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!state && error && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run('List')}>
          {t('accounts.mistral.retry', 'Retry')}
        </Button>
      )}
      {state && (
        <div className="space-y-3">
          <p className="text-xs">
            {state.currentAccount
              ? state.currentAccount.identityKnown
                ? t(
                    'accounts.mistral.signedInAs',
                    'mistral-vibe is using the key of account {{customer}}.',
                    {
                      customer: state.currentAccount.customer
                    }
                  )
                : t(
                    'accounts.mistral.identityUnknown',
                    'mistral-vibe has an API key, but Mistral could not confirm which account it belongs to yet.'
                  )
              : t('accounts.mistral.signedOut', 'mistral-vibe has no API key on this host.')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !state.currentAccount}
              onClick={() => void run('AddCurrent')}
            >
              {t('accounts.mistral.save', 'Save current account')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run('List')}>
              {t('accounts.mistral.refresh', 'Refresh accounts')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || state.accounts.length === 0}
              onClick={() => void run('Usage')}
            >
              {t('accounts.mistral.usage', 'Refresh usage')}
            </Button>
            {busy && (
              <Loader2
                className="size-4 animate-spin"
                aria-label={t('accounts.mistral.working', 'Updating account')}
              />
            )}
          </div>
          {state.accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'accounts.mistral.empty',
                'No saved Mistral Vibe accounts. Sign in with `vibe --setup` or set MISTRAL_API_KEY, then save the current account.'
              )}
            </p>
          ) : null}
          {state.accounts.map((account) => {
            const active =
              currentFingerprint !== null && account.keyFingerprint === currentFingerprint
            const reading = usageLine(
              t,
              usage?.find((entry) => entry.accountId === account.id)
            )
            return (
              <div
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-medium">{account.customer}</p>
                    {active && (
                      <Badge variant="secondary">{t('accounts.mistral.active', 'In use')}</Badge>
                    )}
                  </div>
                  {reading && <p className="text-xs text-muted-foreground">{reading}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run('Remove', account.id)}
                  >
                    {t('accounts.mistral.remove', 'Remove')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          'accounts.mistral.sessions',
          'A picked account is injected into the next Mistral Vibe terminal you start. Running terminals keep their key until restarted.'
        )}
      </p>
    </section>
  )
}
