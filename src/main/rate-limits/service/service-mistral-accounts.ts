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
// The OpenCode class below (FORK.md §8/§11) extends this one, so the service chain stays fork-only.

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

// Fork: OpenCode saved-account quota probing (FORK.md §8/§11), the same shape as Mistral's above.
// The live 'opencode-go' meter (state.opencodeGo) keeps upstream's own key resolution; every
// account row — the active one included — is read with the account's own key through the
// per-account probe, so parallel accounts never borrow the active account's reading.

export abstract class RateLimitServiceOpenCodeAccounts extends RateLimitServiceMistralAccounts {
  protected openCodeAccountsReader: SavedAccountsReader | null = null
  protected openCodeAccountUsageProbe: SavedAccountUsageProbe | null = null
  protected openCodeAccountUsage = new SavedAccountUsageTracker('opencode-go', () =>
    join(getAppEnvironment().getPath('userData'), 'opencode-go-accounts', 'usage-cache.json')
  )

  setOpenCodeAccountsReader(reader: SavedAccountsReader): void {
    this.openCodeAccountsReader = reader
  }

  setOpenCodeAccountUsageProbe(probe: SavedAccountUsageProbe): void {
    this.openCodeAccountUsage.useInactiveProbe(probe, () => this.pushToRenderer())
    // The active account is read through the same probe, so the tracker's live fetch can use it.
    this.openCodeAccountUsageProbe = probe
  }

  /** The active saved account's quota, read with its own key as the tracker's live fetch. */
  protected async readOpenCodeActiveAccountUsage(): Promise<ProviderRateLimits> {
    const accounts = await this.openCodeAccountsReader?.().catch(() => null)
    const activeId = accounts?.activeAccountId ?? null
    const reading =
      activeId && this.openCodeAccountUsageProbe
        ? await this.openCodeAccountUsageProbe(activeId).catch(() => null)
        : null
    return reading ?? this.withoutSavedOpenCodeAccount()
  }

  private withoutSavedOpenCodeAccount(): ProviderRateLimits {
    return {
      provider: 'opencode-go',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: null,
      status: 'unavailable',
      usageMetadata: { failureKind: 'usage-unavailable' }
    }
  }

  /** Probes saved OpenCode accounts on the poll cycle; readings reach the renderer through openCodeAccounts. */
  protected fetchOpenCodeGoAccountsWithSavedAccounts(force: boolean): Promise<ProviderRateLimits> {
    return this.openCodeAccountUsage.track(
      this.openCodeAccountsReader,
      () => this.readOpenCodeActiveAccountUsage(),
      force
    )
  }
}
