import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { callKiroAccounts, type KiroAccountAction } from '@/runtime/runtime-kiro-accounts-client'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type { KiroAccountState } from '../../../../../../shared/kiro-account-types'
import type { RateLimitState, SavedAccountUsage } from '../../../../../../shared/rate-limit-types'
import { Button } from '../../../ui/button'
import { Badge } from '../../../ui/badge'
import { useAppStore } from '../../../../store'

const LOGIN_COMMAND = 'kiro-cli login'

function usageLine(usage: SavedAccountUsage | undefined): string | null {
  const limits = usage?.rateLimits
  if (!limits) {
    return null
  }
  if (limits.monthly) {
    const used = translate('accounts.kiro.creditsUsed', 'Credits: {{percent}}% used', {
      percent: Math.round(limits.monthly.usedPercent)
    })
    return limits.planType ? `${used} · ${limits.planType}` : used
  }
  return limits.error
}

export function KiroAccountsSection({
  owner,
  label
}: {
  owner: RuntimeClientTarget
  label: string
}): React.JSX.Element {
  const [state, setState] = useState<KiroAccountState | null>(null)
  const [fetchedUsage, setFetchedUsage] = useState<SavedAccountUsage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingLogin, setAwaitingLogin] = useState(false)
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const ownerKind = owner.kind
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  const localUsage = useAppStore((s) => s.rateLimits.kiroAccounts)
  const usage = fetchedUsage ?? (ownerKind === 'local' ? localUsage : undefined)

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const currentOwner: RuntimeClientTarget =
      ownerKind === 'environment' && environmentId
        ? { kind: 'environment', environmentId }
        : { kind: 'local' }
    void callKiroAccounts(currentOwner, 'List').then(
      (next) => {
        if (!cancelled) {
          setState(next)
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Kiro accounts could not be loaded.')
        }
      }
    )
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [ownerKind, environmentId])

  async function run(action: KiroAccountAction | 'Usage', accountId?: string): Promise<void> {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      if (action === 'Usage') {
        const snapshot = await callRuntimeRpc<{ rateLimits: RateLimitState }>(
          owner,
          'accounts.list',
          { refreshUsage: true }
        )
        const next = await callKiroAccounts(owner, 'List')
        if (mounted.current) {
          setFetchedUsage(snapshot.rateLimits.kiroAccounts ?? [])
          setState(next)
        }
        return
      }
      const next = await callKiroAccounts(owner, action, accountId)
      if (mounted.current) {
        setState(next)
        if (action === 'BeginSignIn') {
          setAwaitingLogin(true)
          setCopied(false)
        } else if (next.currentAccount) {
          setAwaitingLogin(false)
        }
      }
    } catch (cause) {
      if (action !== 'List') {
        const observed = await callKiroAccounts(owner, 'List').catch(() => null)
        if (mounted.current && observed) {
          setState(observed)
        }
      }
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Kiro account action failed.')
      }
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  const current = state?.currentAccount ?? null
  const currentSaved = !!state?.activeAccountId

  return (
    <section id="accounts-kiro" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AgentIcon agent="kiro" size={16} />
          {translate('accounts.kiro.title', 'Kiro')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'accounts.kiro.scope',
            'Save kiro-cli logins on {{host}} and switch between them. kiro-cli keeps one login, so switching changes it for every new kiro-cli session there.',
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
          {translate('accounts.kiro.retry', 'Retry')}
        </Button>
      )}
      {state && (
        <div className="space-y-3">
          <p className="text-xs">
            {current
              ? current.email
                ? translate('accounts.kiro.signedInAs', 'kiro-cli is signed in as {{email}}.', {
                    email: current.email
                  })
                : translate(
                    'accounts.kiro.identityUnknown',
                    'kiro-cli is signed in, but Kiro could not confirm the account yet. Run kiro-cli once, then refresh.'
                  )
              : translate('accounts.kiro.signedOut', 'kiro-cli is not signed in on this host.')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !current || currentSaved}
              onClick={() => void run('AddCurrent')}
            >
              {translate('accounts.kiro.save', 'Save current account')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (!!current && !current.identityKnown && !currentSaved)}
              onClick={() => void run('BeginSignIn')}
            >
              {translate('accounts.kiro.addAnother', 'Sign in another account')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run('List')}>
              {translate('accounts.kiro.refresh', 'Refresh accounts')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || state.accounts.length === 0}
              onClick={() => void run('Usage')}
            >
              {translate('accounts.kiro.usage', 'Refresh usage')}
            </Button>
            {busy && (
              <Loader2
                className="size-4 animate-spin"
                aria-label={translate('accounts.kiro.working', 'Updating account')}
              />
            )}
          </div>
          {awaitingLogin && !current && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'accounts.kiro.loginSteps',
                  'Your previous login is saved. Run this in a terminal on {{host}}, finish the browser sign-in, then click Refresh accounts and Save current account.',
                  { host: label }
                )}
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs">{LOGIN_COMMAND}</code>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    void window.api.ui
                      .writeClipboardText(LOGIN_COMMAND)
                      .then(() => setCopied(true))
                      .catch((cause: unknown) => setError(String(cause)))
                  }}
                >
                  {copied
                    ? translate('accounts.kiro.copied', 'Copied')
                    : translate('accounts.kiro.copy', 'Copy command')}
                </Button>
              </div>
            </div>
          )}
          {state.accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'accounts.kiro.empty',
                'No saved Kiro accounts. Save the current kiro-cli login to start switching.'
              )}
            </p>
          ) : null}
          {state.accounts.map((account) => {
            const active = state.activeAccountId === account.id
            const reading = usageLine(usage?.find((entry) => entry.accountId === account.id))
            return (
              <div
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-medium">
                      {account.email ?? translate('accounts.kiro.saved', 'Saved Kiro account')}
                    </p>
                    {active && (
                      <Badge variant="secondary">
                        {translate('accounts.kiro.active', 'Active')}
                      </Badge>
                    )}
                  </div>
                  {reading && <p className="text-xs text-muted-foreground">{reading}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || active}
                    onClick={() => void run('Select', account.id)}
                  >
                    {active
                      ? translate('accounts.kiro.inUse', 'In use')
                      : translate('accounts.kiro.switch', 'Switch')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy || active}
                    onClick={() => void run('Remove', account.id)}
                  >
                    {translate('accounts.kiro.remove', 'Remove')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {translate(
          'accounts.kiro.sessions',
          'Running kiro-cli sessions keep their account until restarted. The Kiro IDE keeps its own login.'
        )}
      </p>
    </section>
  )
}
