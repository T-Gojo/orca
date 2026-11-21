# Orca personal fork

This repository is a personal fork of [stablyai/orca](https://github.com/stablyai/orca) (`upstream`),
kept at `T-Gojo/orca` (`origin`). All fork work lives on `main`; upstream is merged into it.
There are no other long-lived branches.

This file is the record of what the fork changes and why, so each upstream merge can keep it.
Update it in the same commit as any new fork change.

## Workflow

| Command                          | What it does                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `config/scripts/fork.sh sync`    | Fetch upstream, merge `upstream/main` into `main`, push `origin main`, `pnpm install`. Stops on conflicts.          |
| `config/scripts/fork.sh build`   | Package `dist/mac-arm64/Orca.app` from the checkout, versioned `<next upstream patch>-custom.<date>.g<sha>`.        |
| `config/scripts/fork.sh install` | Replace `/Applications/Orca.app` with that build (quit Orca first). Deletes the `dist` copy and refreshes the Dock. |
| `config/scripts/fork.sh dev`     | `pnpm dev`, side by side with the installed app.                                                                    |

- Use Node 24: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH` before `pnpm` or `git commit` (hooks fail on newer Node).
- Run `pnpm check:changed` before every push.
- **Signing:** builds are signed with the stable local identity "Orca Fork Local Signing", kept in
  `~/Library/Application Support/orca-fork/signing`. macOS keys Screen Recording and Accessibility grants
  to that signature. Never switch back to ad-hoc signing, or every install asks for the permissions again.
- **Official app backup:** the first install over an official Orca saves it to
  `~/Library/Application Support/orca-fork/backups.noindex/Orca-official.app`. Spotlight skips that
  folder, so only one Orca shows up in search.

## Fork features

Each feature lists its own files first, then the upstream files it hooks into.

### 1. Multiple accounts for Kiro (like Claude Code and Codex)

kiro-cli keeps a single login in `~/Library/Application Support/kiro-cli/data.sqlite3`. Orca saves a snapshot
of that login for each account and swaps it in to switch accounts.

- **Saved logins:** each account's `auth_kv` and `state` rows are stored in an encrypted vault (`userData/kiro-accounts/vault`).
- **Switching:** writes the rows back with compare-and-swap (`BEGIN IMMEDIATE`).
- **Identity:** the account comes from `getUsageLimits` `userInfo`, falling back to `kiro-cli whoami`.
- **Inactive accounts:** their tokens are refreshed through AWS SSO OIDC.
- **Files:** `src/main/kiro/*`, `src/main/foreign-sqlite-readers/readers/kiro-cli-login.ts`, `src/main/foreign-sqlite-readers/kiro-cli-login-result.ts`,
  `src/main/rate-limits/kiro-account-usage-probe.ts`, `src/main/runtime/rpc/methods/accounts/kiro-accounts.ts`,
  `src/shared/kiro-account-types.ts`, `src/shared/rpc-contract/kiro-accounts-params.ts`,
  `src/renderer/src/components/settings/accounts/providers/KiroAccountsSection.tsx`, `src/renderer/src/lib/kiro-launch-accounts.ts`.
- **Hooks into:** the foreign-sqlite reader protocol, dispatch, client and spawn files, `provider-account-services.ts`,
  `rpc/methods/rpc-method-registry.ts`, `AccountsPane.tsx`.

### 2. Per-account Antigravity usage and switching

- **Saved accounts:** each one's quota is read without switching, by running agy against a private file-login home.
- **Files:** `src/main/rate-limits/antigravity-account-usage-probe.ts`, `src/main/rate-limits/saved-account-usage.ts`,
  `src/renderer/src/lib/antigravity-launch-accounts.ts`, `src/renderer/src/lib/single-login-launch-accounts.ts`.

- **Bridge Hub import:** Settings → Accounts → Antigravity → **Import from Bridge Hub** saves the agy accounts that
  Bridge Hub (`openai-base-bridge`) keeps in `~/Library/Application Support/openai-base-windsurf-bridge/auth/antigravity-cli-accounts.json`.
  Already-saved accounts (same refresh token or email) are skipped. Files: `src/main/antigravity/bridge-hub-antigravity-accounts.ts` (+ test),
  `importLogins` in `ForkAntigravityAccountService` (`native-account-fork-service.ts`), the button's hook `use-bridge-hub-antigravity-import.ts`, and `accounts.antigravityImportBridgeHub`, which stays **last** in
  `ANTIGRAVITY_ACCOUNT_METHODS`. The chat sign-in tests pick methods by index.
- **Fork subclass:** the fork's Antigravity account methods (Bridge Hub import, saved-login reads, launch-follows-agy) live in
  `ForkAntigravityAccountService`, which `native-account-host.ts` creates. Upstream's `native-account-service.ts` only
  changes `private` to `protected` on the members it uses, so merges of that file stay small.
- **Launches follow agy:** Bridge Hub and `agy /logout` switch agy's single login behind Orca's back. Before a launch,
  `prepareForLaunch` now moves Orca's selection to the saved account agy is signed in to (or clears it for an unsaved
  login) instead of refusing with "The native Antigravity account changed".

### 3. Account choice when launching agents

- **New-tab "+" menu (new picker):** the agent setup panel has an **Account** row, rendered by the launch footer.
  - Claude and Codex pin the chosen account for terminal launches.
  - Kiro and Antigravity switch their single login first, so the choice also applies to chats.
- **Files:** `src/renderer/src/components/agent/AgentLaunchAccountChoice.tsx`, `src/renderer/src/components/tab-bar/agent-row-launch-accounts.tsx`,
  `src/renderer/src/components/tab-bar/AccountLaunchRow.tsx`.
- **Hooks into:**
  - `AgentLaunchSetupFooter.tsx` renders the row and wraps `onLaunch`.
  - `AgentLaunchSetupPanel.tsx` passes `launchAccountId` into the draft.
  - `AgentPickerDraft.launchAccountId` lives in `src/shared/agent-launch/picker/agent-launch-picker.ts`.
  - `QuickLaunchButton.tsx` reads `draft.launchAccountId`.
  - `launch-agent-in-new-tab.ts` applies the pin.
- **Hand off to another agent:** the hand-off dialog's **Account** select (`ContinuationAccountSelect.tsx`) lists saved
  accounts for every multi-account agent on this computer. Claude/Codex pin it for terminal hand-offs; Antigravity and
  Kiro switch their single login first (`prepare()`), for chat and terminal hand-offs alike.
- **Import rule:** `AgentLaunchAccountChoice.tsx` must not import `AgentLaunchPickerMenu.tsx`. That import is circular
  and breaks the picker tests' mocks.

### 4. Antigravity chats sign in with the saved agy account

- **Why:** upstream's chat server (`agy_acp_server.par`) keeps its own Google login in
  `$GEMINI_HOME/antigravity-acp/acp_token.json`, separate from agy's. Both are issued by the same Google OAuth client,
  so agy's refresh token works for chats.
- **What Orca does:** before every chat spawn, `seedAntigravityChatLogin` writes agy's current refresh token into the chat
  token file in google-auth `authorized_user` format.
  - The client id comes from the login's id-token `aud`.
  - The client secret is read from the installed server binary at runtime, so no secret lives in source.
- **Ownership:** Orca replaces only a token it wrote itself, tracked with the sha256 marker file `orca-seeded-login`.
  A user's own chat sign-in is never replaced.
- **Files:** `src/main/antigravity/antigravity-chat-seeded-login.ts` (+ test).
- **Hooks into:** `antigravity-chat-account.ts` (`prepare`), `antigravity-acp-runtime.ts` (exports `ANTIGRAVITY_ACP_VERSION`).
- **On upstream merges:** if upstream changes the ACP server version, check that the token path, the file format and the
  `<client_id>z<len><secret>` constant layout still hold. The test fixture shows the layout.

### 5. Usage tracking: every session, every account, history kept

- **All sessions, not only Orca's:** Claude, Codex, OpenCode and Muse usage defaults to **All sessions** and **All time**.
  Their `initialScope` and `initialRange` are `'all'` in `usage-provider-slices.ts`.
- **History never shrinks:** when a transcript or rollout disappears, its counted usage is kept. That covers Claude's
  30-day cleanup, Codex archiving and removed accounts.
  - Where: `scanClaudeUsageFiles` (`src/main/claude-usage/scanner.ts`) and `scanCodexUsageFiles`
    (`src/main/codex-usage/scanner.ts`) keep a vanished file's projection.
  - Exception: a live fork that reclaimed every one of its dedupe or event keys already counts that usage, so the
    vanished file is dropped instead of double counting.
  - Tests: `source-cache-write-retention.test.ts` and `scanner-paths.test.ts` ("keeps a deleted rollout's usage as
    history", the legacy-copy case expects 32 tokens and 5 events).
- **Removing a Codex account** runs the usage collection first (`codexAccounts:remove` in `src/main/ipc/codex-accounts.ts`).
- **Per-account ledger:** `src/main/usage/account-usage-*` keeps per-account totals for Claude, Codex, OpenCode, Kiro and
  Antigravity. It only grows; removed accounts are kept and labelled **Removed**.
- **Kiro and Antigravity tokens:** estimated from their session logs and IDE conversation steps
  (`kiro-cli-session-usage.ts`, `antigravity-session-usage.ts`, `antigravity-ide-usage.ts`).

### 6. Usage Analytics UI

- **One filter for every view:** `UsageFilterBar.tsx` and `use-usage-filters.ts` show a single **Range**
  (7d/30d/90d/All time) and **Sessions** (All sessions / Orca workspaces) in the Usage Analytics header.
  - Changing it sets every provider slice at once, so the Overview, each agent's page and the Accounts list always agree.
  - Kiro and Antigravity show only Range, because their logs have no workspace.
  - Each agent page's own filter menu was removed. `filterSections` is optional in `UsageTrackingPaneShell.tsx`.
- **Full-width Stats page:** `isFullWidthStatsPane` in `settings-view-model.ts` gives the Stats section `max-w-none`
  (`settings-page-renderer.tsx`).
- **Minimized by default:**
  - Provider cards (`ProviderUsageRow` in `usage-overview-sections.tsx`) show one summary line with a chevron for details.
  - Each agent's group in the Accounts list (`ProviderAccountGroup` in `UsageAccountsSection.tsx`) shows its totals and
    expands to list accounts.
- **Accounts list:**
  - Grouped by agent, busiest first, with aligned token and cost/credits columns. Usage is full width, with Plan limits below.
  - Rows recorded before account tracking are labelled **Earlier usage** and sort last.

### 7. Status bar and terminals

- **Status bar:** shows usage rows for every saved account (`SavedAccountUsageRows.tsx`, `UsageRosterPanel.tsx`,
  `use-status-bar-controller.ts`).
- **Terminals:** Claude and Codex terminals can open on a chosen account. That touches the pty spawn files in
  `src/main/ipc/pty/*`, `codex-pane-account-registry*`, and the right-click "Change account" menu in
  `ChangeAccountMenuItems.tsx`.

### 8. Cross-agent delegation (Claude → Antigravity, Kiro, Codex) with usage-aware accounts

A coordinator agent (usually Claude Code in an Orca terminal) hands self-contained tasks to other
agents as Orca orchestration workers, on whichever saved account has usage left, then verifies the
result. It builds on upstream's `orca orchestration` (workers, `worker_done`, `send`, retries).

- **`worker-start --account <id|email|system|auto>`** (agents: claude, codex, antigravity, kiro;
  existing workspaces only, not `--on`/`--terminal`/`new-child`/`new-top-level`):
  - claude/codex: the existing per-terminal pin env (`ORCA_PIN_CLAUDE_ACCOUNT` /
    `ORCA_PIN_CODEX_ACCOUNT`).
  - antigravity/kiro keep ONE machine-wide login, so a worker gets a private `HOME` overlay
    (`userData/delegation-homes/<agent>/<accountId>/home`): symlinks to every entry of the real
    home except the agent's login location, which holds that account's saved login —
    agy: `.gemini/antigravity-cli/antigravity-oauth-token` plus `SSH_CONNECTION` so agy uses the
    file login instead of the keychain; kiro: a copy of `Library/Application Support/kiro-cli/data.sqlite3`
    with the account's login rows. Verified: parallel accounts work and the shared login and
    Bridge Hub rotation are never touched. Tokens the agent refreshes are written back to Orca's
    vault on the next start. Not supported on Windows (refused with a message).
  - `auto` refreshes usage and picks the least-used account under the threshold; the worker is
    forced to terminal mode (chats sign in their own way).
- **`orca delegation usage | route | preferences`**: per-account used % for every delegation agent
  (from the rate-limit service, including inactive saved accounts), a router that applies
  preferences and prints the worker-start flags plus fallbacks, and the preferences file
  `userData/orca-delegation.json` (`agentOrder`, `models`, `maxUsedPercent`, `kinds`, `autoDelegation`; defaults
  written on first use).
- **Auto-delegation (on by default):** `fork/hooks/orca-auto-delegation.sh` is a Claude Code
  `UserPromptSubmit` hook (registered in `~/.claude/settings.json` by `fork.sh install` or
  `fork.sh hooks`, next to Orca's own hook entries, which Orca's installer leaves alone). In an Orca
  terminal it adds `orca delegation advice` to every prompt: the coordinator's own used %, the best
  account per worker agent, and "delegate by default" (above `autoDelegation.ownUsedPercent`, default
  70%, "delegate all bulk work"). It is silent outside Orca, for workers (`ORCA_DELEGATION_WORKER=1`
  from `--account`, or a session whose first prompt was a dispatch brief), with
  `ORCA_AUTO_DELEGATION=off`, or when `autoDelegation.enabled` is false in the preferences file. It
  uses the last usage readings so a prompt is not slowed; `delegation route` refreshes before a start.
- **Waking the coordinator:** the skill has the coordinator run `orchestration check --run <id>
  --types worker_done,... --wait` as a background command, so Claude Code's own background-task
  notification wakes it. Upstream's pane wake-up (typing a note into the coordinator's prompt) did not
  fire in the hidden dev test window, where CLI-created terminals are "orphaned" (no UI tab); the
  background wait does not depend on it.
- **Skill:** `fork/skills/agent-delegation/SKILL.md`, installed to `~/.claude/skills` by
  `fork.sh install` (or `fork.sh skills`). Kept out of upstream's bundled-skill generator on purpose.
- **Files:** `src/main/delegation/*` (preferences, usage, route, advice, overlay home, account env,
  service, worker-account), `fork/hooks/orca-auto-delegation.sh`, `src/main/runtime/rpc/methods/delegation/delegation-methods.ts`,
  `src/shared/delegation/delegation-types.ts`, `src/shared/rpc-contract/delegation-params.ts`,
  `src/cli/delegation/delegation-handlers.ts`, `src/cli/specs/delegation.ts`.
- **macOS `login` resets HOME:** Orca starts shells through `/usr/bin/login` (`tcc-login-shell.ts`), which
  resets `HOME`. The worker env also carries `ORCA_ACCOUNT_HOME`, and the login trampoline exports it as `HOME`
  when set (one fork line in `tcc-login-shell.ts`). Linux shells get `HOME` directly.
- **Verified end to end (2026-11-21, dev instance):** two Antigravity workers on two saved accounts in parallel
  (by id and by email), a Kiro worker with `--account auto` and a Codex worker with `--account system` all
  reported `worker_done`. The machine-wide agy login was unchanged, and each overlay token was refreshed by
  its own run. Kiro still asks "Trust this workspace?" once per new folder; trust lives in `~/.kiro`, which the
  overlay shares, so trust a folder in kiro once and workers inherit it.
- **Hooks into upstream:** `account` in `orchestration-worker-start-params.ts`;
  `resolveWorkerStartAccount` + `workerAccountMode` in `worker-start-method.ts`;
  `workerAccountEnv` in `worker-start-agent-placement.ts`; `accountEnv` in
  `createExistingWorktreeWorkerTerminal` (`worker-placement-topology.ts`); `--account` in the CLI
  worker-start handler and spec; `DELEGATION_METHODS` in `rpc-method-registry.ts`; the
  `delegation` handler group and specs index.

### Upstream gate notes (main-process rules)

- Fork main-process code uses only `fs/promises` (upstream's `main-sync-fs` ratchet). The Kiro vault store is
  async like upstream's Antigravity store.
- The account usage ledger has no fixed interval timer: it collects once at startup, then after usage scans and
  on window focus, at most every 10 minutes (`collectAccountUsageAfterActivity`, upstream's recurring-timer rule).
- `config/main-blocking-helper-baseline.txt` carries fork rows marked `# fork:`. Each one reaches an upstream
  entry-path `existsSync` (SQLite reader worker, usage scan worker, Antigravity credential backend), not new
  blocking code. Drop a row if upstream makes that helper async.
- Kiro's Accounts search entries live in `accounts-kiro-search.ts`, appended in
  `settings-navigation-capability-sections.ts`; `accounts-search.ts` is upstream's. The Accounts pane renders
  `KiroAccountsPaneSection` (`accounts-pane-kiro-section.tsx`). Codex's pinned-account launch reuses
  `mirrorSystemInto` in `runtime-home-service-managed-home.ts`.

## Merging upstream

1. `config/scripts/fork.sh sync`. git `rerere` is on, so resolutions repeat.
2. **Resolve conflicts by keeping both sides:** take upstream's structure and put the fork's addition back on top.
   When upstream moves a file, move the fork's edit with it; don't restore the old path.
3. Files that conflict most often:
   - `src/renderer/src/components/tab-bar/QuickLaunchButton.tsx`, `agent-row-launch-accounts.tsx`, the agent picker
     files (`AgentLaunchSetupPanel.tsx`, `AgentLaunchSetupFooter.tsx`)
   - `src/renderer/src/components/stats/*` (Overview, panes, sections)
   - `src/main/claude-usage/scanner.ts`, `src/main/codex-usage/scanner.ts`
   - `src/main/usage/usage-scan-worker-*`, `src/main/rate-limits/service/*`
   - `src/main/ipc/pty/*` (account pins)
   - `src/renderer/src/components/ui/dropdown-menu.tsx` (SubTrigger `variant`: default, launch, launch-row)
   - `src/renderer/src/i18n/locales/en.json` (keep both key sets)
   - `src/shared/rpc-contract/rpc-params-catalog.generated.ts`: regenerate; don't hand-merge
4. After resolving, check that each behaviour above still holds, then:
   - `pnpm tc`
   - `pnpm test src/main/claude-usage src/main/codex-usage src/main/usage src/main/kiro src/main/antigravity src/renderer/src/components/agent src/renderer/src/components/tab-bar src/renderer/src/components/stats --maxWorkers=2`
   - `pnpm check:changed`
5. `fork.sh build`, then `fork.sh install`. Afterwards check: the Account row in the "+" agent panel, Settings →
   Accounts → Kiro/Antigravity, and Stats & Usage totals matching across tabs.

Comments starting with `Fork:` in upstream files mark fork-only lines, so they are easy to find in a conflict.
