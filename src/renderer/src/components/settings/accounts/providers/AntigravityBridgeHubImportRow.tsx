import type { RefObject } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type {
  AntigravityAccountState,
  AntigravityAccountTarget
} from '../../../../../../shared/agent-accounts/antigravity/antigravity-account-types'
import { Button } from '../../../ui/button'
import { useBridgeHubAntigravityImport } from './use-bridge-hub-antigravity-import'

/** Fork: the agy terminal card's "Import from Bridge Hub" row, for this computer's host only. */
export function AntigravityBridgeHubImportRow({
  owner,
  target,
  busy,
  guard
}: {
  owner: RuntimeClientTarget
  target: AntigravityAccountTarget
  busy: boolean
  guard: {
    pending: RefObject<boolean>
    mounted: RefObject<boolean>
    setBusy: (busy: boolean) => void
    setError: (error: string | null) => void
    setState: (state: AntigravityAccountState) => void
  }
}): React.JSX.Element | null {
  const t = useTranslate()
  const bridgeHub = useBridgeHubAntigravityImport({ owner, target, ...guard, t })
  if (!bridgeHub.available) {
    return null
  }
  return (
    <div data-settings-row="" className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0 text-xs text-muted-foreground">{bridgeHub.notice}</span>
      <Button
        variant="outline"
        size="xs"
        disabled={busy}
        onClick={() => void bridgeHub.importAccounts()}
      >
        {t('accounts.antigravity.bridgeHubImport', 'Import from Bridge Hub')}
      </Button>
    </div>
  )
}
