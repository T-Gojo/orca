import { useState, type RefObject } from 'react'
import type { Translate } from '@/i18n/use-translate'
import { importBridgeHubAntigravityAccounts } from '@/runtime/provider-accounts/sign-in/runtime-antigravity-accounts-client'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type {
  AntigravityAccountState,
  AntigravityAccountTarget
} from '../../../../../../shared/antigravity-account-types'

/** Fork: Bridge Hub keeps agy logins on this computer; they become saved accounts here. */
export function useBridgeHubAntigravityImport({
  owner,
  target,
  pending,
  mounted,
  setBusy,
  setError,
  setState,
  t
}: {
  owner: RuntimeClientTarget
  target: AntigravityAccountTarget
  pending: RefObject<boolean>
  mounted: RefObject<boolean>
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setState: (state: AntigravityAccountState) => void
  t: Translate
}): { available: boolean; notice: string | null; importAccounts: () => Promise<void> } {
  const [notice, setNotice] = useState<string | null>(null)
  async function importAccounts(): Promise<void> {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await importBridgeHubAntigravityAccounts(owner, target)
      if (mounted.current) {
        setState(result.state)
        setNotice(
          t(
            'accounts.antigravity.bridgeHubImported',
            'Imported {{imported}} accounts from Bridge Hub; {{skipped}} were already saved.',
            { imported: result.imported, skipped: result.skipped }
          )
        )
      }
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : 'Bridge Hub accounts could not be imported.'
        )
      }
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  return {
    available: owner.kind === 'local' && target.runtime === 'host',
    notice,
    importAccounts
  }
}
