import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import {
  SavedAccountUsageTracker,
  type SavedAccountUsageProbe,
  type SavedAccountsReader
} from '../saved-account-usage'
import { RateLimitServiceState } from './service-state'

// Fork: Mistral Vibe saved-account quota probing (FORK.md §10). Mistral has no live provider
// reading here — every saved account, starting with the active one, is read with its own key.

function withoutSavedAccount(): ProviderRateLimits {
  return {
    provider: 'mistral',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'unavailable',
    usageMetadata: { failureKind: 'usage-unavailable' }
  }
}

export abstract class RateLimitServiceMistralAccounts extends RateLimitServiceState {
  protected mistralAccountsReader: SavedAccountsReader | null = null
  protected mistralAccountUsageProbe: SavedAccountUsageProbe | null = null
  protected mistralAccountUsage = new SavedAccountUsageTracker('mistral', () =>
    join(getAppEnvironment().getPath('userData'), 'mistral-accounts', 'usage-cache.json')
  )

  setMistralAccountsReader(reader: SavedAccountsReader): void {
    this.mistralAccountsReader = reader
  }

  setMistralAccountUsageProbe(probe: SavedAccountUsageProbe): void {
    this.mistralAccountUsage.useInactiveProbe(probe, () => this.pushToRenderer())
    // The active account is read through the same probe, so the tracker's live fetch can use it.
    this.mistralAccountUsageProbe = probe
  }

  /** The active saved account's quota, read with its own key as the tracker's live fetch. */
  protected async readMistralActiveAccountUsage(): Promise<ProviderRateLimits> {
    const accounts = await this.mistralAccountsReader?.().catch(() => null)
    const activeId = accounts?.activeAccountId ?? null
    const reading =
      activeId && this.mistralAccountUsageProbe
        ? await this.mistralAccountUsageProbe(activeId).catch(() => null)
        : null
    return reading ?? withoutSavedAccount()
  }

  /** Probes saved Mistral accounts on the poll cycle; readings reach the renderer through mistralAccounts. */
  protected fetchMistralWithSavedAccounts(force: boolean): Promise<ProviderRateLimits> {
    return this.mistralAccountUsage.track(
      this.mistralAccountsReader,
      () => this.readMistralActiveAccountUsage(),
      force
    )
  }
}
