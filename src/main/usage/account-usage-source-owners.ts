import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import type {
  AccountUsageProvider,
  UsageSourceRollup
} from '../../shared/account-usage-ledger-types'
import { SYSTEM_DEFAULT_ACCOUNT_KEY } from '../../shared/account-usage-ledger-types'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { resolveOrcaManagedCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import { getClaudeProfileRouter } from '../claude-accounts/profiles/routing/claude-profile-installed-router'
import type { ResolvedSourceAccount } from './account-usage-ledger-model'

export type LedgerSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'codexManagedAccounts'
  | 'activeCodexManagedAccountId'
  | 'activeCodexManagedAccountIdsByRuntime'
>

/** A saved single-login account (Kiro, Antigravity, Mistral Vibe) and which one the CLI is signed in to now. */
export type SingleLoginAccounts = {
  accounts: { id: string; email: string | null; organizationId?: string | null }[]
  activeAccountId: string | null
  currentEmail: string | null
}

/** `<root>/<folder>/<id>/home`: Orca's per-account folder layout for Claude and Codex. */
function accountIdFromHome(home: string, folder: string): string | null {
  const accountDir = dirname(home)
  return basename(home) === 'home' && basename(dirname(accountDir)) === folder
    ? basename(accountDir)
    : null
}

function withDetail(email: string, detail: string | null | undefined): string {
  return detail ? `${email} · ${detail}` : email
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sessions each Claude home ran, from its live session records and last session per project.
 * Why: every account folder links the same transcript folder, so a log alone names no account.
 */
export async function readClaudeSessionOwners(
  homes: readonly { home: string; accountKey: string; stateFile?: string }[]
): Promise<Map<string, string>> {
  const owners = new Map<string, string>()
  for (const { home, accountKey, stateFile } of homes) {
    let names: string[] = []
    try {
      names = (await readdir(join(home, 'sessions'))).filter((name) => name.endsWith('.json'))
    } catch {
      // No live sessions in this home.
    }
    for (const name of names) {
      const record = await readJson(join(home, 'sessions', name))
      if (isRecord(record) && typeof record.sessionId === 'string') {
        owners.set(record.sessionId, accountKey)
      }
    }
    const state = await readJson(stateFile ?? join(home, '.claude.json'))
    const projects = isRecord(state) && isRecord(state.projects) ? state.projects : {}
    for (const project of Object.values(projects)) {
      if (isRecord(project) && typeof project.lastSessionId === 'string') {
        owners.set(project.lastSessionId, accountKey)
      }
    }
  }
  return owners
}

function claudeHomes(
  settings: LedgerSettings
): { home: string; accountKey: string; stateFile?: string }[] {
  const router = getClaudeProfileRouter()
  const defaultHome = router?.systemDefaultHome() ?? join(homedir(), '.claude')
  const homes: { home: string; accountKey: string; stateFile?: string }[] = [
    // Without CLAUDE_CONFIG_DIR, Claude keeps its state beside the folder rather than in it.
    {
      home: defaultHome,
      accountKey: SYSTEM_DEFAULT_ACCOUNT_KEY,
      stateFile: join(homedir(), '.claude.json')
    },
    { home: defaultHome, accountKey: SYSTEM_DEFAULT_ACCOUNT_KEY }
  ]
  for (const home of router?.accountHomes() ?? []) {
    const id = accountIdFromHome(home, 'claude-profiles')
    if (id && settings.claudeManagedAccounts.some((account) => account.id === id)) {
      homes.push({ home, accountKey: id })
    }
  }
  return homes
}

export type SourceResolver = (rollup: UsageSourceRollup) => ResolvedSourceAccount

/** Builds the per-collection resolver; reads live session records once, not per source. */
export async function createSourceResolver(
  provider: AccountUsageProvider,
  settings: LedgerSettings,
  singleLogin: SingleLoginAccounts | null
): Promise<SourceResolver> {
  if (provider === 'claude') {
    const owners = await readClaudeSessionOwners(claudeHomes(settings))
    const labelOf = (key: string): string | null => {
      const account = settings.claudeManagedAccounts.find((entry) => entry.id === key)
      return account ? withDetail(account.email, account.organizationName) : null
    }
    const activeKey =
      settings.activeClaudeManagedAccountIdsByRuntime?.host ??
      settings.activeClaudeManagedAccountId ??
      SYSTEM_DEFAULT_ACCOUNT_KEY
    return (rollup) => {
      const owner = rollup.session ? owners.get(rollup.session) : undefined
      const accountKey = owner ?? activeKey
      return { accountKey, label: labelOf(accountKey), certain: owner !== undefined }
    }
  }
  if (provider === 'codex') {
    const runtimeHome = resolvePath(resolveOrcaManagedCodexHomePath())
    const activeKey =
      settings.activeCodexManagedAccountIdsByRuntime?.host ??
      settings.activeCodexManagedAccountId ??
      SYSTEM_DEFAULT_ACCOUNT_KEY
    const labelOf = (key: string): string | null => {
      const account = settings.codexManagedAccounts.find((entry) => entry.id === key)
      return account ? withDetail(account.email, account.workspaceLabel) : null
    }
    return (rollup) => {
      const home = rollup.home ? resolvePath(rollup.home) : null
      const ownHome = home ? accountIdFromHome(home, 'codex-accounts') : null
      if (ownHome) {
        return { accountKey: ownHome, label: labelOf(ownHome), certain: true }
      }
      // The runtime home runs whichever account is selected; any other home is the user's own.
      if (home === runtimeHome) {
        return { accountKey: activeKey, label: labelOf(activeKey), certain: false }
      }
      return { accountKey: SYSTEM_DEFAULT_ACCOUNT_KEY, label: null, certain: home !== null }
    }
  }
  if (provider === 'opencode') {
    return (rollup) => ({
      accountKey: rollup.session ?? 'opencode',
      label: rollup.session,
      certain: true
    })
  }
  // Fork: Mistral Vibe sessions carry owner.json's `${organizationId}+${userId}` in
  // `session`; a matching saved account wins, sessions without an owner fall back to
  // whoever's key was active when they first appeared (FORK.md §10).
  if (provider === 'mistral') {
    const byOrganization = new Map<string, { id: string; email: string | null }>()
    for (const account of singleLogin?.accounts ?? []) {
      if (account.organizationId) {
        byOrganization.set(account.organizationId, { id: account.id, email: account.email })
      }
    }
    const active = singleLogin?.accounts.find((entry) => entry.id === singleLogin.activeAccountId)
    const fallbackKey = active?.id ?? SYSTEM_DEFAULT_ACCOUNT_KEY
    const fallbackLabel = active?.email ?? singleLogin?.currentEmail ?? null
    return (rollup) => {
      const organizationId = rollup.session ? rollup.session.split('+')[0] : ''
      const match = organizationId ? byOrganization.get(organizationId) : undefined
      return match
        ? { accountKey: match.id, label: match.email, certain: true }
        : { accountKey: fallbackKey, label: fallbackLabel, certain: false }
    }
  }
  // kiro-cli and agy keep one login at a time, so new usage belongs to whoever is signed in.
  const active = singleLogin?.accounts.find((entry) => entry.id === singleLogin.activeAccountId)
  const accountKey = active?.id ?? SYSTEM_DEFAULT_ACCOUNT_KEY
  const label = active?.email ?? singleLogin?.currentEmail ?? null
  return () => ({ accountKey, label, certain: false })
}
