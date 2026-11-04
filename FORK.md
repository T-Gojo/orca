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
  `src/main/rate-limits/kiro-account-usage-probe.ts`, `src/main/runtime/rpc/methods/kiro-accounts.ts`,
  `src/shared/kiro-account-types.ts`, `src/shared/rpc-contract/kiro-accounts-params.ts`,
  `src/renderer/src/components/settings/accounts/providers/KiroAccountsSection.tsx`, `src/renderer/src/lib/kiro-launch-accounts.ts`.
- **Hooks into:** the foreign-sqlite reader protocol, dispatch, client and spawn files, `provider-account-services.ts`,
  `rpc/methods/index.ts`, `AccountsPane.tsx`.

### 2. Per-account Antigravity usage and switching

- **Saved accounts:** each one's quota is read without switching, by running agy against a private file-login home.
- **Files:** `src/main/rate-limits/antigravity-account-usage-probe.ts`, `src/main/rate-limits/saved-account-usage.ts`,
  `src/renderer/src/lib/antigravity-launch-accounts.ts`, `src/renderer/src/lib/single-login-launch-accounts.ts`.

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
