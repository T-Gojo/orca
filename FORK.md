# Orca personal fork

This repository is a personal fork of [stablyai/orca](https://github.com/stablyai/orca) (`upstream`),
kept at `T-Gojo/orca` (`origin`). All fork work lives on `main`. There are no other long-lived branches.

**Upstream cutoff / last reviewed commit:** `fd05416de7c9` (`2026-11-25`, stored in `fork/UPSTREAM_CUTOFF`).
Going forward, instead of doing full `git merge upstream/main` merges, this fork tracks upstream manually every
2–3 days via `config/scripts/fork.sh upstream-check` and selectively cherry-picks or re-implements only the
upstream features and fixes we want natively on `main`.

This file is the source of truth for what the fork changes and why. Update it in the same commit as any new
fork change or upstream port.

## Workflow

| Command                                 | What it does                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/scripts/fork.sh upstream-check` | Fetch `upstream` and list all commits since `fork/UPSTREAM_CUTOFF` for manual selective review/porting.                                        |
| `config/scripts/fork.sh build`          | Package `dist/mac-arm64/Orca.app` from the checkout, versioned `<next upstream patch>-custom.<date>.g<sha>`.                                   |
| `config/scripts/fork.sh install`        | Replace `/Applications/Orca.app` (quit Orca first), delete staging copy, refresh Dock, and run `skills`, `hooks`, and `mcp`.                   |
| `config/scripts/fork.sh skills`         | Install `fork/skills/*` (`agent-delegation`, `external-browser-mcp`) to all 6 CLI homes and ensure Vibe `skill_paths`.                         |
| `config/scripts/fork.sh hooks`          | Install `fork/hooks/orca-auto-delegation.sh` for Claude Code, Codex, and Kiro.                                                                 |
| `config/scripts/fork.sh mcp`            | Upgrade `browser-use[cli]` and configure `browser-use`, `background-computer-use`, `dusk`, `rikugan`, and `orca-hermes` MCP across all 6 CLIs. |
| `config/scripts/fork.sh ecosystem`      | Control or sync the Unified Ecosystem (`up`, `down`, `status`, `sync`, `ask`, `review`, `learn`).                                              |
| `config/scripts/fork.sh mobile-build`   | Run `expo prebuild` and Gradle `assembleRelease` (`arm64-v8a` by default; `ORCA_ANDROID_ARCHS=all` for all ABIs).                              |
| `config/scripts/fork.sh mobile-install` | Install the built Android APK over wireless/USB ADB (`--serial <id>`, `--remove-old` to uninstall legacy `com.stably.orca.mobile`).            |
| `config/scripts/fork.sh dev`            | Run `pnpm dev` side by side with the installed app.                                                                                            |
| `config/scripts/fork.sh sync`           | Legacy full merge (`git merge upstream/main`); only use if explicitly choosing to re-sync full history instead of selective porting.           |

- Use Node 24: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH` before `pnpm` or `git commit` (hooks fail on newer Node).
- Run `pnpm check:changed --base=origin/main --maxWorkers=2 --timeout=120` (or `--base=$(cat fork/UPSTREAM_CUTOFF)` for full fork diff) before every push.
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
  - Mistral Vibe pins the chosen account's saved API key into the terminal too (FORK.md section 10).
  - Kiro and Antigravity switch their single login first, so the choice also applies to chats.
- **Files:** `src/renderer/src/components/agent/AgentLaunchAccountChoice.tsx`, `src/renderer/src/components/tab-bar/agent-row-launch-accounts.tsx`,
  `src/renderer/src/components/tab-bar/AccountLaunchRow.tsx`.
- **Hooks into:**
  - `AgentLaunchSetupFooter.tsx` renders the row and wraps `onLaunch`.
  - `AgentLaunchSetupPanel.tsx` passes `launchAccountId` into the draft.
  - `AgentPickerDraft.launchAccountId` lives in `src/shared/agent-launch/picker/agent-launch-picker.ts`.
  - `QuickLaunchButton.tsx` is gone upstream; the launch menu (`src/renderer/src/components/agent/launch-menu/AgentMenuItems.tsx`)
    reads `draft.launchAccountId` now.
  - `launch-agent-in-new-tab.ts` applies the pin.
- **Hand off to another agent:** the hand-off dialog's **Account** select (`ContinuationAccountSelect.tsx`) lists saved
  accounts for every multi-account agent on this computer. Claude/Codex pin it for terminal hand-offs; Antigravity and
  Kiro switch their single login first (`prepare()`), for chat and terminal hand-offs alike. Mistral Vibe
  joins the pin side there: its accounts pin terminal hand-offs, read from the vault RPC
  (`mistral-launch-accounts.ts`).
- **Import rule:** `AgentLaunchAccountChoice.tsx` must not import `AgentLaunchPickerMenu.tsx`. That import is circular
  and breaks the picker tests' mocks.

### 4. Antigravity chats sign in with the saved agy account — now upstream's own

Upstream's "run every chat on agy" rework (merged 2026-12) removed Orca's managed ACP server and its
separate chat token file: every Antigravity chat now runs `agy acp --login` on agy's own home with
agy's own Google login, so chats always sign in with the saved agy account natively. The fork's
`seedAntigravityChatLogin` (`antigravity-chat-seeded-login.ts`, `antigravity-acp-runtime.ts`) is
therefore retired. No fork files remain here; if a future upstream merge reintroduces a split chat
login, rebuild the seeding from FORK.md history (`git log -- fork/FORK.md`).

### 5. Usage tracking: every session, every account, history kept

- **All sessions, not only Orca's:** Claude, Codex, OpenCode and Muse usage defaults to **All sessions** and **All time**.
  Their `initialScope` and `initialRange` are `'all'` in `usage-provider-slices.ts`.
- **History never shrinks:** when a transcript or rollout disappears, its counted usage is kept. That covers Claude's
  30-day cleanup, Codex archiving and removed accounts.
  - Where: `scanClaudeUsageFiles` (`src/main/claude-usage/scanner.ts`) and `scanCodexUsageFiles`
    (`src/main/codex-usage/scanner.ts`) keep a vanished file's projection.
  - Exception: a live fork that reclaimed every one of its dedupe or event keys already counts that usage, so the
    vanished file is dropped instead of double counting.
  - Tests: `source-cache-write-retention.test.ts` and `scanner-history-retention.test.ts` ("keeps a deleted rollout's usage as
    history"; the legacy-copy case expects 32 tokens and 5 events). Upstream deleted `scanner-paths.test.ts` with the rest of
    its low-value scanner suite; the fork's history cases live on in the fork-owned `scanner-history-retention.test.ts`. The
    old `reuse` sidecar flag is gone (upstream's schema-7 `unchangedSourceCache` owns retention now).
- **Removing a Codex account** runs the usage collection first (`accounts.removeCodex` wiring in
  `src/main/ipc/accounts/codex-accounts.ts` via the shared hook `src/main/usage/account-switch-usage-hook.ts`).
- **Per-account ledger:** `src/main/usage/account-usage-*` keeps per-account totals for Claude, Codex, OpenCode, Kiro, Mistral
  (Vibe) and Antigravity. It only grows; removed accounts are kept and labelled **Removed**.
- **Kiro and Antigravity tokens:** estimated from their session logs and IDE conversation steps
  (`kiro-cli-session-usage.ts`, `antigravity-session-usage.ts`, `antigravity-ide-usage.ts`).
- **Mistral tokens:** real cumulative counters from the Vibe session journals, never estimated
  (`vibe-session-usage.ts`, section 10).

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
  `use-status-bar-controller.ts`). Mistral Vibe's saved accounts ride the same saved-accounts path
  (`mistralAccounts` in the controller → `usage-roster-saved-accounts.tsx`), one row per account (FORK.md §10).
- **Terminals:** Claude and Codex terminals can open on a chosen account. The pin env lives in
  `src/shared/agent-terminal-account-pin.ts`; the spawn-side hooks are `claude-accounts/claude-terminal-account-pin.ts`,
  `codex-accounts/runtime-home/routing/runtime-home-service-launch.ts` and `codex/configuration/homes/codex-pane-account-registry*`,
  plus the right-click "Change account" menu in `ChangeAccountMenuItems.tsx`.

### 8. Cross-agent delegation (Claude → Antigravity, Kiro, Codex, Mistral Vibe, OpenCode) with usage-aware accounts

A coordinator agent (usually Claude Code in an Orca terminal) hands self-contained tasks to other
agents as Orca orchestration workers, on whichever saved account has usage left, then verifies the
result. It builds on upstream's `orca orchestration` (workers, `worker_done`, `send`, retries).

- **`worker-start --account <id|email|system|auto>`** (agents: claude, codex, antigravity, kiro,
  mistral-vibe, opencode;
  existing workspaces only, not `--on`/`--terminal`/`new-child`/`new-top-level`):
  - claude/codex: the existing per-terminal pin env (`ORCA_PIN_CLAUDE_ACCOUNT` /
    `ORCA_PIN_CODEX_ACCOUNT`).
  - mistral-vibe: same pin-mode idea, env instead of overlay — the saved account's API key is injected
    as `MISTRAL_API_KEY`, which mistral-vibe ranks above `$VIBE_HOME/.env` and the keychain, so parallel
    workers on different accounts are isolated with no overlay home (and no Windows refusal). `system`
    injects nothing: the machine default key (env, `.env`, keychain) wins. `ORCA_DELEGATION_WORKER=1`
    is added for mistral workers like every other agent.
  - opencode: upstream's managed data accounts are the accounts (FORK.md §11) — the worker env carries
    `ORCA_DATA_ACCOUNT_ID=<id>`, upstream's own per-launch store request, which the pty host-env
    assembly turns into that account's XDG overlay (`ManagedDataAccountService.environmentForAccount`).
    `system` asks for the machine's own store (`ORCA_DATA_ACCOUNT_ID=system`), which matters when a
    saved account is active: without it the active account's overlay would apply. Env only, so
    Windows is fine. See §11 for the accounts, rows and pins.
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
  `userData/orca-delegation.json` (`agentOrder`, `models`, `maxUsedPercent`, `kinds`, `profiles`, `autoDelegation`; defaults
  written on first use).
  - mistral-vibe rows: one per saved account (label = the whoami customer short form, matched by it
    for `--account <email>` semantics), used % and the `monthly` reset from the billing probe
    (`rateLimits.mistralAccounts`), plus a `system` row only when the machine's own key matches no
    saved account (unread usage, no env injected). Profile tier `standard` like kiro. Preferences
    files saved before mistral-vibe keep their own `agentOrder`: add `"mistral-vibe"` to it (or delete
    `agentOrder`) to delegate to it; its profile tier merges in on read.
  - opencode rows: one per saved managed account (label = its saved display name, matched by it for
    `--account <name>`), used % per window from the per-account probe (`rateLimits.openCodeAccounts`,
    FORK.md §11), plus a `system` row only when the machine store's own Go key matches no saved
    account's key (unread usage). Profile tier `standard`; `agentOrder` behaves like mistral-vibe's.
- **Auto-delegation (on by default):** `fork/hooks/orca-auto-delegation.sh` is a `UserPromptSubmit`
  hook for every coordinator CLI (Claude Code `~/.claude/settings.json`, Codex `~/.codex/hooks.json`,
  Kiro `~/.kiro/hooks/orca-auto-delegation.json`; registered by `fork.sh install` or
  `fork.sh hooks`, next to Orca's own hook entries, which Orca's installer leaves alone). In an Orca
  terminal it adds the **usage brief** (`orca delegation advice`) to every prompt: the coordinator's
  own 5h/weekly usage and pace (when it would run out before reset, or how much of its own quota
  resets unused), each worker agent's tier and best two accounts with reset clocks and "resets
  unused" share, and the best light and strong route. The coordinator (Claude Opus) makes the call
  per task with the skill's judgment guide; the numbers are computed, the decision is not rule-based.
  - Pace (`delegation-pace.ts`): from each window's reset time and length (5h, 7d, 30d), the share
    an even pace would have used by now minus the share used is what "resets unused"; the average
    rate since the window started projects when it runs out. Windows resetting within 20 minutes
    count as nothing at risk; a reading older than its reset counts as a fresh window.
  - Routing (`delegation-route.ts`): agents at or above the task's `--tier` (preferences `profiles`:
    antigravity light, kiro, mistral-vibe and opencode standard, codex and claude strong), quota that resets unused first, then
    usable share; exact tier and preferred order break near-ties. A Claude Code session's own
    account (from `CLAUDE_CONFIG_DIR` = `claude-profiles/<id>`) is never offered; the user's other
    Claude accounts are strong workers.
  - Cost: the brief is about 1,000 characters; when nothing changed materially (shares to 5%) since
    the session's last brief within 30 minutes, the CLI prints a one-line note instead (`--session`,
    keys in `$TMPDIR/orca-delegation-brief`). Stale readings trigger a throttled background refresh,
    so a prompt never waits on usage probes.
  - Kiro's live login: kiro-cli is often switched to an account Orca has not saved. When its current
    login is not a saved account, the table adds it as `kiro` `system` (usage from `rateLimits.kiro`,
    plan plus active bonus credits; email from a background `kiro-cli whoami`, kept per login), and
    workers run on it with `--account system` (no overlay).
  - Silent outside Orca, for workers (`ORCA_DELEGATION_WORKER=1` from `--account`, or a session whose
    first prompt was a dispatch brief), with `ORCA_AUTO_DELEGATION=off`, or with
    `autoDelegation.enabled: false`.
  - No separate router model: a small fast model (e.g. a Cloudflare Workers AI Flash-class model)
    would add an API key, network latency on every prompt and a weaker judge than the coordinator
    already in the loop; the coordinator gets the numbers instead.
- **Waking the coordinator:** the skill has the coordinator run `orchestration check --run <id>
  --types worker_done,... --wait` as a background command, so Claude Code's own background-task
  notification wakes it. The other CLIs have no background-command notification, so there the wait
  is a foreground `check` once per turn (the skill's per-CLI section covers it). Upstream's pane
  wake-up (typing a note into the coordinator's prompt) did not
  fire in the hidden dev test window, where CLI-created terminals are "orphaned" (no UI tab); the
  background wait does not depend on it.
- **Skill:** `fork/skills/agent-delegation/SKILL.md`, installed to every coordinator CLI's skills dir
  (see the next bullets) by `fork.sh install` (or `fork.sh skills`). Kept out of upstream's
  bundled-skill generator on purpose.
- **Every CLI can coordinate (double-sided kits):** `fork.sh skills`/`hooks`/`install` install the
  delegation kit for all six CLIs, so any of them can be the coordinator, not just Claude Code:
  - **codex:** hook group merged into Orca-managed `~/.codex/hooks.json` `UserPromptSubmit`
    (`ORCA_DELEGATION_AGENT=codex /bin/sh ~/.codex/hooks/orca-auto-delegation.sh`, timeout 8; the
    stdout enters developer context) + skill in `~/.codex/skills`.
  - **kiro:** standalone `~/.kiro/hooks/orca-auto-delegation.json`, mirroring Orca's own
    `orca-agent-status.json` entry shape (`UserPromptSubmit` trigger, pane guard, `-f/-r/-x` checks,
    stdin drain fallback; `ORCA_DELEGATION_AGENT=kiro`) + skill in `~/.kiro/skills`.
  - **antigravity / vibe / opencode:** skill only — their per-prompt hook paths are UNCONFIRMED, so
    they coordinate (foreground wait per the skill) but get no automatic usage brief: agy's
    PreInvocation stdout injection is unverified (skill in `~/.gemini/skills`, one of
    `AGY_HOME_SKILL_FOLDERS`); vibe has no per-prompt hook at all (skill in `~/.vibe/skills`);
    opencode's v2 plugin hook is unconfirmed (skill in `~/.config/opencode/skills`).
  - The hook itself is agent-generic: `--agent "${ORCA_DELEGATION_AGENT:-claude}"`, and a payload
    with no `session_id` (codex/kiro) keys the brief and worker marker by `ORCA_PANE_KEY` instead.
    `fork.sh` functions: `install_fork_hooks` (claude merge unchanged, codex merge, kiro file),
    `install_fork_skills` (six homes), `merge_user_prompt_submit` (shared filter-and-append node
    helper), `ensure_vibe_skill_paths`.
  - **Merge gotchas:** `~/.codex/hooks.json` is Orca-managed — the merge drops only groups whose
    command contains `orca-auto-delegation` and re-appends ours, so Orca's groups keep their array
    positions and their positional `hooks.state` trust entries (`user_prompt_submit:0:0` in
    `~/.codex/config.toml`) stay valid. Our new group's `trusted_hash` is NOT script-computable
    (the hash format does not reproduce locally from any candidate encoding), so codex shows its
    one-time trust prompt on the first prompt after install — documented, not scripted. Kiro V2
    default agent caveat: on Kiro's V2 engine the built-in default agent has no global hook config
    (Orca patches user-owned agent files), so the standalone hooks file only reaches agents that
    load `~/.kiro/hooks/*.json` — same limitation Orca's own kiro hook has. Vibe does not autoload
    `~/.vibe/skills`: `ensure_vibe_skill_paths` appends top-level `skill_paths = ["~/.vibe/skills"]`
    to `~/.vibe/config.toml` only when absent (verified top-level array key via `vibe config schema`),
    inserted before the first `[table]` header so it cannot land inside a table.
- **Files:** `src/main/delegation/*` (preferences, usage, route, advice, overlay home, account env,
  service, worker-account), `fork/hooks/orca-auto-delegation.sh`, `src/main/runtime/rpc/methods/delegation/delegation-methods.ts`,
  `src/shared/delegation/delegation-types.ts`, `src/shared/rpc-contract/delegation-params.ts`,
  `src/cli/delegation/delegation-handlers.ts`, `src/cli/specs/delegation.ts`.
- **macOS `login` resets HOME:** Orca starts shells through `/usr/bin/login`
  (`src/main/providers/shell-launch/macos/tcc-login-shell.ts`), which resets `HOME`. The worker env also carries
  `ORCA_ACCOUNT_HOME`, and the login trampoline exports it as `HOME` when set (one fork line in `tcc-login-shell.ts`).
  Linux shells get `HOME` directly.
- **Verified end to end (2026-11-21, dev instance):** two Antigravity workers on two saved accounts in parallel
  (by id and by email), a Kiro worker with `--account auto` and a Codex worker with `--account system` all
  reported `worker_done`. The machine-wide agy login was unchanged, and each overlay token was refreshed by
  its own run. Kiro still asks "Trust this workspace?" once per new folder; trust lives in `~/.kiro`, which the
  overlay shares, so trust a folder in kiro once and workers inherit it.
- **Hooks into upstream:** `account` in `orchestration-worker-start-params.ts`;
  `resolveWorkerStartAccount` + `workerAccountMode` in `worker-start-method.ts`;
  `workerAccountEnv` in `start/placement/worker-start-agent-placement.ts` (upstream moved the placement files);
  `accountEnv` in `createExistingWorktreeWorkerTerminal` (`start/placement/worker-placement-topology.ts`);
  `--account` in the CLI worker-start handler and spec; `DELEGATION_METHODS` in `rpc-method-registry.ts`; the
  `delegation` handler group and specs index.
- **max-lines gate:** upstream keeps `worker-start-method.ts` at the 300-line gate, so the fork's hooks only fit
  because the upstream question-link glue (`questionLink`/`linkedParams`/`withLink` in `startWorker`) moved into
  `bindWorkerQuestion` in `start/worker-question-link.ts` (marked `// Fork:`). On the next merge, if upstream adds
  lines to `startWorker`, move more of it into helpers instead of growing the fork hooks. The same applies to
  `antigravity-accounts.ts`: the Bridge Hub method lives in the fork-owned
  `src/main/runtime/rpc/methods/accounts/antigravity-import-bridge-hub-method.ts`, still **last** in
  `ANTIGRAVITY_ACCOUNT_METHODS` (upstream tests index into that array).

### 10. Multiple accounts for Mistral Vibe

Mistral Vibe keeps one API key at a time, read from env, `~/.vibe/.env` or the macOS keychain. Orca saves a
key per account in an encrypted vault; using one is per-terminal env pinning, never switching.

- **Ground truth (verified vs mistral-vibe 3.1.4):** credential priority is env `MISTRAL_API_KEY` >
  `$VIBE_HOME/.env` (env relocates the config, default `~/.vibe`) > macOS keychain (service `ai.mistral.vibe`,
  `MISTRAL_API_KEY`; a browser sign-in provisions a subscription-scoped key). `MISTRAL_API_KEY` in the spawn env
  outranks the keyring, and the keychain item is only ever read, never written.
- **Identity:** `GET https://console.mistral.ai/api/vibe/whoami` with the Bearer key returns
  `{plan_type, plan_name, customer_id, ...}`. An account = a saved API key, deduped by the first 32 hex chars of
  sha256(key); whoami names it (customer id short form — it returns no email). Saving is refused while whoami
  cannot name the account.
- **RPC (no select method):** `accounts.mistralList` (`workspace`), `accounts.mistralAddCurrent`,
  `accounts.mistralRemove` (`accounts-admin`). Raw keys never cross RPC; the service exposes
  `readAccountApiKey` for main-process launch env injection only.
- **Files:** `src/shared/mistral-account-types.ts`, `src/shared/rpc-contract/mistral-account-params.ts`,
  `src/main/mistral/mistral-account-store.ts`, `mistral-credential-source.ts`, `mistral-whoami.ts`,
  `mistral-account-service.ts`, `mistral-account-host.ts` (+ `mistral-account-service.test.ts`),
  `src/main/runtime/rpc/methods/accounts/mistral-accounts.ts`, plus the renderer pin files
  `src/renderer/src/runtime/runtime-mistral-accounts-client.ts`,
  `src/renderer/src/lib/mistral-launch-accounts.ts`, `MistralAccountsSection.tsx` (+ the
  `accounts-pane-mistral-section.tsx` / `accounts-mistral-search.ts` wrappers) and
  `src/main/mistral/mistral-terminal-account-pin.ts`.
- **Hooks into:** `rpc-method-registry.ts` (import + one `...MISTRAL_ACCOUNT_METHODS` spread, exactly two lines),
  `account-runtime-capabilities.ts` (`MISTRAL_ACCOUNTS_RUNTIME_CAPABILITY = 'accounts.mistral-vibe.v1'`),
  and regenerated `rpc-params-catalog.generated.ts` (don't hand-merge).
- **Merge gotchas:** `rpc-method-registry.ts` runs at the oxlint max-lines gate (279/300 non-blank non-comment
  after this hook); if upstream grows it, the mistral spread must move into a combined fork method group to keep
  the two lines. `mistral-vibe`'s own key locations (`$VIBE_HOME/.env`, keychain `ai.mistral.vibe`) are external
  facts, not Orca files — re-verify on the next mistral-vibe release before touching `mistral-credential-source.ts`.
- **Session usage (ledger `mistral` provider):** `src/main/mistral/vibe-session-usage.ts` reads
  `$VIBE_HOME/logs/session/unified/<id>/` in the usage scan worker (result key `mistral` on
  `collectAccountSources`, threaded through `usage-scan-worker-{protocol,client,spawn,entry}.ts`). Cumulative
  `projection_delta` counters are real, so nothing is estimated: input excludes the cached share, `totalTokens`
  = non-cached input + output + cached (mistral-vibe's own total leaves cached out), the day is the max record's
  session `updatedAt`, `activity` counts metered records. Rollups carry `owner.json`'s `organizationId+userId`
  so `account-usage-source-owners.ts` credits the saved account with that organization (`SingleLoginAccounts.organizationId`),
  else the account whose key was active. Mirrors kiro: no scanner-side vanished-session retention — the ledger's
  growth deltas keep history; mtime-keyed session cache like `kiro-cli-session-usage.ts`.
- **Quota probe:** `src/main/rate-limits/mistral-account-usage-probe.ts` reads `GET api.mistral.ai/v1/billing/budget`
  with a saved key (`vibe_budget.usage_percentage/reset_at` becomes the `monthly` window; `reset_at` only names the
  reset, so the window length is the remaining time). 403 = the account lacks `see_org_inference_usage` → status
  `unavailable`; `GET /v1/billing/subscription` (`plan_name`) is best-effort and never blocks the reading. Mistral
  API keys never rotate, so the probe's `update` login hook is a documented no-op.
- **Rate-limit wiring:** `saved-account-usage-wiring.ts` mistral block (`setMistralAccountsReader` + probe), the
  fork-owned partial `rate-limits/service/service-mistral-accounts.ts` (tracker, cache
  `userData/mistral-accounts/usage-cache.json`, setters, active-account probe) hooked with one
  `service-fetch-control.ts` composition line, and one `service-full-cycle-preparation.ts` poll trigger — with no
  live provider there is no `state.mistral`, readings publish as `mistralAccounts` (optional field beside
  `kiroAccounts` in `rate-limit-types.ts`). `provider: 'mistral'` joins `ProviderRateLimits` (display name in
  `usage-provider-windows.ts`; filtered from the polling plan in `service-polling.ts`; status-bar letter `V`).
- **Saved-account roster/stats hooks:** the status bar's saved-accounts path carries `mistralAccounts`
  (`use-status-bar-controller.ts` → `usage-roster-saved-accounts.tsx`, the same single-login row shape and
  `SavedAccountUsageRows.tsx` rows as Kiro), and the Stats page's plan-limits list gains a
  `savedAccountRows('mistral', ...)` entry in `usage-account-limits-model.ts` — with no live provider meter
  there is no fallback row, only the saved accounts' readings (FORK.md §7). Mistral Vibe also joins cross-agent
  delegation (`--agent mistral-vibe --account`, tier standard, monthly reset) — see section 8.
- **Per-terminal pinning (pin-mode, like Claude/Codex — not switch-mode like Kiro):** the picker and hand-off
  offer saved accounts through `useMistralLaunchAccounts` (`mistral-launch-accounts.ts`, kiro's >=2-accounts
  rule, System default first), wired on the pin side in `agent-row-launch-accounts.tsx` (terminal rows only)
  and `ContinuationAccountSelect.tsx` (terminal hand-offs; `prepare` has nothing to switch, the pick rides
  `launchInput.launchAccountId` like Claude/Codex). The launch encodes `ORCA_PIN_MISTRAL_ACCOUNT` with the
  shared `agent-terminal-account-pin.ts` helpers (one fork branch in `agent-terminal-account-pins.ts`), and
  main consumes it at the codex pin's site in `ipc/pty/host-env/spawn-host-env.ts`:
  `applyMistralTerminalAccountPin` injects `MISTRAL_API_KEY=<saved key>` and strips the hint; WSL drops it,
  an unresolvable id refuses like Claude's pin. Accounts pane + search hooks: `AccountsPane.tsx` (+1 import,
  +1 render after Kiro) and `settings-navigation-capability-sections.ts` (+1 search-entries merge).

### 11. OpenCode delegation and account pins (upstream's managed data accounts)

Upstream already gives OpenCode multiple accounts: `ManagedDataAccountService` (providers 'opencode'/'devin',
`userData/managed-data-accounts`) stores each account's data home and exposes
`environmentForAccount('opencode', id)` → `{XDG_DATA_HOME, XDG_STATE_HOME, OPENCODE_DB: 'opencode.db',
OPENCODE_AUTH_CONTENT: ''}`, applied to launches by `applyManagedDataAccountEnvironment`
(`managed-data-accounts/launch-environment.ts`), which honors the per-launch store request
`ORCA_DATA_ACCOUNT_ID` (id or `system`). This fork adds per-terminal account choice and delegation rows
on top, without touching upstream's account plumbing.

- **Per-account usage rows:** every row — the active account included — is read with that account's own
  key: the probe (`src/main/rate-limits/opencode-account-usage-probe.ts`, fork-owned) builds the account's
  env (`environmentForAccount`) and reuses upstream's `fetchOpenCodeGoUsage` keyed path, so a row never
  borrows the active account's reading (upstream's live `opencode-go` meter keeps its own resolution).
  The tracker/cache mirrors Mistral's (`SavedAccountUsageTracker('opencode-go', …,
  `userData/opencode-go-accounts/usage-cache.json`), fork partial `RateLimitServiceOpenCodeAccounts`appended to`service-mistral-accounts.ts`, one poll-trigger line in `service-full-cycle-preparation.ts`,
  reader + probe wired in `saved-account-usage-wiring.ts`), publishing as `openCodeAccounts`beside`mistralAccounts`in`rate-limit-types.ts`. Roster/stats: `use-status-bar-controller.ts`(+1 line) →`usage-roster-saved-accounts.tsx` (`opencode-go`branch, rows under the live meter row) and`usage-account-limits-model.ts` (`opencode-go`moves from single-account providers to`savedAccountRows(...)` with the live meter as fallback). Key resolution reuses upstream's sync
  SQLite/DB reads; fingerprints for the system-row match are cached 10 minutes (kiro-whoami precedent).
- **Per-terminal pin:** the picker and hand-off offer the managed accounts through
  `useOpenCodeLaunchAccounts` (`use-openencode-launch-accounts.ts`, kiro's >=2-accounts rule, System
  default first, `accounts.listData` RPC), wired pin-side in `agent-row-launch-accounts.tsx` and
  `ContinuationAccountSelect.tsx` (both opencode and opencode2). The launch encodes
  `ORCA_PIN_OPENCODE_ACCOUNT` (`agent-terminal-account-pin.ts` union + `agent-terminal-account-pins.ts`
  branch); main consumes it at the mistral pin's site in `spawn-host-env.ts`:
  `applyOpenCodeTerminalAccountPin` (`src/main/opencode/opencode-terminal-account-pin.ts`) validates the
  id and sets `ORCA_DATA_ACCOUNT_ID` (upstream applies the overlay), `system-default` becomes the
  `system` store request, WSL drops it, an unresolvable id refuses like Claude's pin. `spawn-host-env.ts`
  sits near the 300-line gate after this hook: if upstream grows it, move the pin consumption calls
  into one shared fork helper.
- **Delegation:** opencode joins `DELEGATION_AGENTS` (append-only, last), `worker-start --agent opencode
  --account` (see §8), and the usage tables: `--account <label>` matches the saved display name;
  the `system` row appears only when the machine store's Go key matches no saved account's key
  (both resolved through upstream's key tiers over each account's env). Preferences: `agentOrder`
  default ends with `opencode`, profile tier `standard` merges in on read like mistral-vibe's.

### 12. Usage windows ledger (1h / 5h / weekly / all-time)

Extends the local per-account usage ledger (`orca-account-usage-ledger.json`, kept at schema `version: 2`)
with UTC-hour buckets (`'YYYY-MM-DDTHH'`) and per-model breakdowns so Stats & Usage tracks token usage per
CLI, account, and model across `1h`, `5h`, `7d`, `30d`, `90d`, and `all` windows — stored until manually removed.

- **Hourly bucketing:**
  - Timestamped scanners (`vibe-session-usage.ts`, `kiro-cli-session-usage.ts`, `antigravity-session-usage.ts`)
    emit exact `hourlyBuckets` through `SourceRollupBuilder` (`usage-source-rollups.ts`). Mistral Vibe walks
    journal segments chronologically with monotonic high-water marks so multi-hour sessions split into exact
    per-hour deltas whose sum equals the session total.
  - Day-only scanners (Claude, Codex, OpenCode) stamp non-baseline positive daily deltas into the current UTC
    hour (`recordHourlyForSource` in `account-usage-hourly-model.ts`); baseline collections skip hourly stamping
    so pre-existing logs do not spike `1h`.
  - Window cutoffs: `1h` = current UTC hour (1 bucket), `5h` = last 5 UTC hours (`now - 4h..now`); `7d`/`30d`/
    `90d`/`all` aggregate from daily `account.buckets` so pre-existing v2 daily history is preserved 100%.
  - Fixed OpenCode cache double-counting in `account-usage-buckets.ts` (`cachedInputTokens` already includes
    `cacheWriteInputTokens`).
- **Manual removal without re-crediting:** `removeAccountUsageEntry` deletes either a single model's buckets
  or an entire account's stored buckets/hourly history while leaving `providers[provider].sources` (`seen` and
  `seenHourly`) intact, so existing logs on disk never re-credit removed history on subsequent refreshes, while
  genuinely new usage above those high-water marks is credited normally.
- **Files:** `src/shared/account-usage-windows-types.ts`, `src/main/usage/account-usage-hourly-model.ts`,
  `src/main/usage/account-usage-windows-summary.ts`, `src/main/usage/account-usage-windows.test.ts`,
  `src/renderer/src/components/stats/use-account-usage-windows.ts`,
  `src/renderer/src/components/stats/UsageHourlyChart.tsx`,
  `src/renderer/src/components/stats/UsageWindowsAccountRow.tsx`,
  `src/renderer/src/components/stats/UsageWindowsSection.tsx`.
- **Hooks into:** `account-usage-ledger-types.ts` (`hourlyBuckets?`), `usage-source-rollups.ts` (optional `hour`
  arg on `SourceRollupBuilder.add`), `account-usage-ledger-model.ts` (`seenHourly?`, `hourly?`,
  `recordHourlyForSource`), `account-usage-ledger.ts` (`getWindowsSnapshot`, `removeEntry`),
  `account-usage-desktop.ts` (`accountUsage:getWindowsSnapshot`, `accountUsage:refreshWindows`,
  `accountUsage:removeEntry`), `agent-usage-api.ts` + `account-usage-bridge.ts`, `UsageOverviewPane.tsx`
  (+1 import, +1 render above `UsageAccountsSection`), `en.json` (`stats.usageWindows.*`).

### 13. Background-task sidebar panel with ETA estimates

Adds a **Background Tasks** right-sidebar panel (`'background-tasks'`) that unifies live agent panes across
every CLI (`claude`, `kiro`, `codex`, `antigravity`, `mistral-vibe`, `opencode`, and any other agent) with
durable orchestration workers, complete with explicitly labeled estimated ETAs, subagent progress, click-to-focus,
and worker stop controls.

- **Durable worker + duration-prior RPC (`delegation.backgroundTasks`):**
  - Appended at the end of `DELEGATION_METHODS` in `src/main/runtime/rpc/methods/delegation/delegation-methods.ts`
    (keeping `rpc-method-registry.ts` untouched) with params `DelegationBackgroundTasksParams` in
    `src/shared/rpc-contract/delegation-params.ts`.
  - Electron-free query (`src/main/delegation/background-tasks-query.ts`) reads active dispatches plus recently
    settled dispatches (default 60 minutes) from the orchestration DB (`runtime.getExistingOrchestrationDb()`),
    extracts `agent`, `model`, and `account` from `worker_dispatches.start_options`, counts mailbox messages per
    worker, and computes empirical `medianMs` and `p75Ms` duration priors per agent plus a `globalPrior` from up to
    500 completed dispatches (clamped 5s–4h).
- **ETA estimation heuristics (`background-task-eta.ts` + `background-task-eta.test.ts`):**
  - Every estimate is explicitly labeled as an estimate (`~Xm left (est.)`, `Over typical (est.)`,
    `Waiting on input`, `Stalled? (est.)`) and never renders `0s left` or negative values.
  - Precedence: terminal `done`/`failed` → `waiting`/`blocked` → stale heartbeat (`>120s` without background wait) →
    subagent completion-ratio pacing (60/40 blend with prior when `>=2` subagents have partial completion after 5s) →
    per-pane `stateHistory` working-turn median (60/40 blend with prior) → DB `agentPrior` (`>=2` samples) →
    `globalPrior` (`>=3` samples) → conservative per-agent defaults (`antigravity: 90s`, `kiro`/`mistral-vibe`/
    `opencode`: `150s`, `codex`/`claude`: `210s`, fallback `180s`).
  - Applies stage bounds for early (`launching`/`starting`, capped `<=15%`) and late (`verifying`/`settling`,
    floored `>=80%`) orchestration stages, and switches to `overrun` past `1.15x` expected duration.
- **Files:** `src/shared/delegation/background-tasks-types.ts`, `src/main/delegation/background-tasks-query.ts`,
  `src/renderer/src/components/right-sidebar/background-tasks/background-task-eta.ts` (+ `background-task-eta.test.ts`),
  `src/renderer/src/components/right-sidebar/background-tasks/background-task-item.ts`,
  `src/renderer/src/components/right-sidebar/background-tasks/background-task-merge.ts`,
  `src/renderer/src/components/right-sidebar/background-tasks/use-active-background-task-count.ts`,
  `src/renderer/src/components/right-sidebar/background-tasks/use-background-tasks-feed.ts`,
  `src/renderer/src/components/right-sidebar/background-tasks/BackgroundTaskCard.tsx`,
  `src/renderer/src/components/right-sidebar/background-tasks/BackgroundTasksPanel.tsx`.
- **Hooks into:** `STATIC_RIGHT_SIDEBAR_TABS` (`ui-chrome-types.ts`), `normalizeRightSidebarTab`
  (`ui-selection-normalization.ts`), `normalizeRightSidebarRoute` (`right-sidebar-route.ts`),
  `getDefaultRightSidebarActivityItems` (`right-sidebar-default-activity-items.ts` +
  `activity-bar-arrangement.test.ts`), `useRightSidebarActivityItems` (`use-right-sidebar-activity-items.ts`),
  `RightSidebarPanelContent` (`right-sidebar-panel-content.tsx`), `delegation-params.ts`,
  `delegation-methods.ts`, regenerated `rpc-params-catalog.generated.ts`, and `en.json`
  (`rightSidebar.backgroundTasks.*`).

### 14. External Browser Use, Dusk, and Computer Use MCP (all 6 CLIs)

Disables Orca's internal browser for agent/CLI flows so agents use external browser and desktop MCP servers (`dusk`, `browser-use`, and `background-computer-use`) across all six CLIs instead of spawning Orca browser tabs.

- **Internal-browser agent policy (`src/main/browser/fork-external-browser-policy.ts` + `.test.ts`):**
  - Electron-free helper `shouldBlockAgentInternalBrowser(caller?)` and `assertInternalBrowserAllowedForAgent(caller?)`.
  - Blocks agent/CLI internal browser tab opens (`browser.tabCreate`, `browser.openUrl`) and prevents PTY host-env assembly from setting `BROWSER` to Orca's internal browser launcher, throwing a `BrowserError` pointing to `dusk`, `browser-use`, and `background-computer-use`.
  - Leaves manual desktop "+ Browser" (renderer store), mobile screencast (`caller.clientKind === 'mobile'`), offscreen page links (`caller.opensPageLink === true`), and upstream Vitest suites (`VITEST` set unless `ORCA_BLOCK_INTERNAL_BROWSER=1`) unaffected.
  - **Escape hatch:** set `ORCA_ALLOW_INTERNAL_BROWSER=1` (or `ORCA_BLOCK_INTERNAL_BROWSER=0`) to re-enable Orca's internal browser for agent flows.
- **Cross-CLI MCP installer (`fork/scripts/install-browser-use-mcp.mjs` + `config/scripts/fork.sh mcp`):**
  - Pure Node ESM, zero external deps, idempotent, preserves existing servers, comments, and symlinks (`~/.gemini/antigravity/mcp_config.json`), and never prints auth headers or tokens.
  - Discovers `$HOME/.local/bin/browser-use` (or `PATH`, falling back to `uvx --from browser-use[cli] browser-use --cli-mcp`), `$HOME/.local/bin/computer-use-mcp` (`serve`), and any existing local `dusk` entry from Claude/Kiro/Gemini/Antigravity configs (or `http://127.0.0.1:8797/mcp` if `/Applications/Dusk.app` exists).
  - Configures all 6 CLIs: Claude Code (`~/.claude.json` + Orca managed profiles `$orcaData/claude-profiles/*/home/.claude.json`), Codex (`~/.codex/config.toml`), Kiro (`~/.kiro/settings/mcp.json`), Antigravity (`~/.gemini/antigravity/mcp_config.json` and `~/.gemini/settings.json`), Mistral Vibe (`~/.vibe/config.toml` `[[mcp_servers]]` + `[mcp_servers.auth]`), and OpenCode (`~/.config/opencode/opencode.json`).
  - `config/scripts/fork.sh mcp` upgrades `browser-use[cli]` via `uv` unless `ORCA_SKIP_BROWSER_USE_UPGRADE=1` (warning-only on offline failure) and runs the installer; also invoked automatically by `config/scripts/fork.sh install`.
  - Fixed `ensure_vibe_skill_paths()` in `config/scripts/fork.sh` to define `config` and `dir` and `mkdir -p "$HOME/.vibe"` before invoking `node`.
- **Skill (`fork/skills/external-browser-mcp/SKILL.md`):** installed to all 6 CLIs by `config/scripts/fork.sh skills`, instructing agents when to pick `dusk`, `browser-use`, or `background-computer-use` and not to open Orca internal browser tabs.
- **Hooks into:** `src/main/runtime/browser/tabs/browser-tab-creation.ts` (`assertInternalBrowserAllowedForAgent` in `browserTabCreate` and `browserOpenUrlOnClient`), `src/main/ipc/pty/host-env/assembly.ts` (`!shouldBlockAgentInternalBrowser()` guard on `baseEnv.BROWSER`).

### 15. Mobile full control and Android wireless build

Extends both the desktop-bundled mobile web UI and the standalone Android app with full orchestration control, background task monitoring with ETA estimates, token usage windows (`1h`/`5h`/`7d`/`all`), multi-CLI quota bars, and Kiro/Antigravity/Mistral Vibe account management, plus local release APK build/install commands.

- **Usage windows runtime RPC (`delegation.usageWindows`):**
  - Electron-free bridge `src/main/usage/account-usage-windows-bridge.ts` registers a module-level reader callback wired in `src/main/usage/account-usage-desktop.ts`, so `src/main/runtime/**` stays Electron-free.
  - Added `DelegationUsageWindowsParams` in `src/shared/rpc-contract/delegation-params.ts` and appended `delegation.usageWindows` at the end of `DELEGATION_METHODS` in `src/main/runtime/rpc/methods/delegation/delegation-methods.ts`.
- **Mobile RPC allowlists (`src/main/runtime/rpc/server/runtime-rpc-mobile-fork-methods.ts`):**
  - Execution-host allowlist (`EXECUTION_HOST_METHODS` in `runtime-rpc-mobile-method-routing.ts`): `orchestration.workerDockStop`, `orchestration.workerDockAcknowledge`, `orchestration.workerDockResult`, `orchestration.workerStop`, `orchestration.workerList`, `orchestration.runList`, `orchestration.runShow`, `orchestration.taskList`, `orchestration.taskCreate`, `orchestration.taskUpdate`, `orchestration.send`.
  - Paired-desktop allowlist (`PAIRED_DESKTOP_METHODS` in `runtime-rpc-mobile-paired-desktop-methods.ts`): `delegation.usage`, `delegation.route`, `delegation.preferences`, `delegation.backgroundTasks`, `delegation.usageWindows`, `accounts.kiroList`, `accounts.kiroSelect`, `accounts.antigravityList`, `accounts.antigravitySelect`, `accounts.mistralList`, `accounts.listData`.
- **Mobile UI (fork-owned components + minimal `// Fork:` hooks):**
  - **Worker Dock Stop & Clear:** `mobile/src/session/native-chat/input/tasks/use-mobile-worker-dock-actions.ts` and `MobileWorkerDockRowActions.tsx` hooked into `MobileNativeChatOverlay.tsx`, `use-mobile-native-chat-composer-tray.ts`, and `MobileNativeChatWorkerDock.tsx` for per-worker Stop (`orchestration.workerDockStop`), Clear (`orchestration.workerDockAcknowledge`), and Clear all.
  - **Background tasks & ETA card:** `mobile/src/home/tabs/mobile-fork-background-tasks-rpc.ts` and `MobileForkBackgroundTasksSection.tsx` hooked into `MobileHomeAgentsTab.tsx` to poll `delegation.backgroundTasks` across connected hosts, render elapsed time + labeled estimated ETA (`est.`) across all 6 CLIs, and expose Stop (`orchestration.workerStop`).
  - **Token windows & multi-CLI quotas:** `mobile/src/home/tabs/mobile-fork-usage-rpc.ts` and `MobileForkUsageWindowsSection.tsx` hooked into `MobileHomeUsageTab.tsx` to display `1h`/`5h`/`7d`/`all` token windows (`In · Out · Cache`, expandable per-model breakdown) and saved-account quota bars for Kiro, Antigravity, Mistral Vibe, and OpenCode.
  - **Multi-provider accounts:** `mobile/src/accounts/mobile-fork-accounts-rpc.ts` and `MobileForkProviderAccountsSection.tsx` hooked into `MobileAccountsScreen.tsx` to list Kiro, Antigravity, and Mistral Vibe saved accounts and switch Kiro/Antigravity logins from mobile.
- **Standalone Android APK workflow (`config/scripts/fork.sh`):**
  - `config/scripts/fork.sh mobile-build`: configures `ANDROID_HOME` and Java 17, runs `expo prebuild --platform android --no-install`, and builds `mobile/android/app/build/outputs/apk/release/app-release.apk` via `./gradlew assembleRelease`.
  - `config/scripts/fork.sh mobile-install [--serial <id>] [--remove-old]`: installs the built release APK via ADB (`--remove-old` explicitly uninstalls `com.stably.orca.mobile` first; never uninstalls without the flag).

### 16. Unified Ecosystem Connectors (Rikugan, OpenClaw Channels & Multimodal, Hermes Intelligence Suite)

Makes Orca the single orchestrator, UI, and local endpoint (`127.0.0.1:6770`) across Mac, Android (`dev.orca.app`), Telegram, and WhatsApp while keeping Rikugan on the Mac internal SSD as the single personal knowledge and continuity brain — engineered to keep running off the Mac internal SSD (`~/.config/orca-ecosystem/`) even when the external Thunder SSD is unplugged.

- **Rikugan Connector (`src/main/ecosystem/rikugan-connector.ts` + `fork/skills/rikugan/SKILL.md`):**
  - Native TypeScript port of `Rikugan/integrations/hermes/plugin/rikugan/__init__.py` talking to `http://127.0.0.1:5680/v1/tools/*` and `/mcp`.
  - Auto-provisions or reuses a scoped `Orca Ecosystem` standard-tier token (`RIKUGAN_TOKEN` in `~/.config/orca-ecosystem/.env`, mode `0600`, denying `brain.records.delete` and `brain.records.any`).
  - Pre-turn `prefetchRikuganContext` attaches `<memory-context>` with per-session `seen` node-ID deduplication and once-per-session owner `brief` (`<=3.5s` budget), and post-turn `observeEcosystemTurnEnded` records secret-scrubbed session summaries (`record_session`) into Rikugan's daily reflection loop.
- **OpenClaw Channel, Multimodal & Webhook Bridge (`src/main/ecosystem/openclaw-connector.ts` + `fork/ecosystem/orca-openclaw-bridge.mjs`):**
  - Staged into `~/.config/orca-ecosystem/runtime/` (`com.thunder.orca-ecosystem-bridge` LaunchAgent on `127.0.0.1:6770`).
  - **Telegram:** long-polling Bot API, 6-digit single-use DM pairing (`orca ecosystem pair --code <n>`), live typing + throttled draft message edits, voice-note STT transcription, and `/status`, `/review`, `/rikugan` commands.
  - **WhatsApp:** Baileys multi-device Web socket (`~/.config/orca-ecosystem/whatsapp-auth/`), QR pairing (`orca ecosystem whatsapp --login` + Desktop QR view), Note-to-Self ("Message Yourself") + owner allowlist, hard broadcast/story block (`status@broadcast`, `@newsletter`), outbound message-ID loop guard, `👀`/`✅` reactions, and voice PTT transcription.
  - **Unified Endpoint & Webhooks:** `POST /v1/ask`, `POST /webhooks/:hookName`, and `POST /v1/notify` (proactive outbound push), typed via `ECOSYSTEM_CHANNEL_IDS` in `src/shared/ecosystem/ecosystem-types.ts`.
- **Hermes Intelligence Suite (`src/main/ecosystem/hermes-learning-connector.ts`, `hermes-skills-hub.ts`, `fork/ecosystem/orca-hermes-mcp.mjs`, `fork/skills/hermes-suite/SKILL.md`):**
  - Registers `orca-hermes` MCP across all 6 CLIs providing `orca_ptc` (Programmatic Tool Calling over a local Python/Unix-socket RPC kernel with 40%/60% `50 KB` stdout cap + spill file recovery), `orca_review` (independent senior reviewer subagent), `orca_skills_hub`, `orca_session_recall`, and `ecosystem_notify`.
  - Enforces Trojan-Source/bidi unicode stripping, Hermes's `<=60`-char skill routing description rule, `skill-scanner` validation, and automatic snapshots in `~/.config/orca-ecosystem/skill-backups/` for 1-tap `undo-skill`.
  - Cleanly parks duplicate standalone `ai.hermes.gateway` on `orca ecosystem up` while keeping `~/.hermes` intact for Hermes ACP inside Orca.
- **CLI, RPC & UI surfaces:**
  - `src/cli/specs/ecosystem.ts`, `src/cli/ecosystem/ecosystem-handlers.ts`, `src/cli/ecosystem/ecosystem-handler-group.ts` (`orca ecosystem {up|down|status|sync|ask|review|learn|undo-skill|skills|pair|telegram|whatsapp|notify}`).
  - Appends `delegation.ecosystemStatus`, `delegation.ecosystemControl`, `delegation.ecosystemAsk`, and `delegation.ecosystemLearn` at the end of `DELEGATION_METHODS` and `MOBILE_FORK_PAIRED_DESKTOP_METHODS`.
  - Desktop `EcosystemHubPanel.tsx` (`[Background Tasks | Ecosystem]` switcher in `BackgroundTasksPanel.tsx`) and Mobile `MobileForkEcosystemSection.tsx` (in `MobileHomeAgentsTab.tsx` & `MobileHomeBotsTab.tsx`).

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

## Upstream tracking (cutoff & selective porting)

Full upstream merges are retired as of cutoff commit `fd05416de7c9` (`fork/UPSTREAM_CUTOFF`, 2026-11-25).
Instead, every 2–3 days (manually triggered):

1. **Inspect new upstream commits:** run `config/scripts/fork.sh upstream-check` (fetches `upstream` and lists
   `$(cat fork/UPSTREAM_CUTOFF)..upstream/main --oneline --no-merges`).
2. **Triage selectively:**
   - **Skip** upstream churn, telemetry, UI experiments, or refactors we do not need.
   - **Cherry-pick** small self-contained fixes, model/provider updates, or security patches (`git cherry-pick -x <sha>`).
   - **Port / re-implement natively** larger features we want by inspecting `git show <sha>` / `git diff <cutoff>..upstream/main -- <path>`
     and implementing them cleanly on top of our own fork architecture (avoiding merge-conflict resolution and unwanted upstream drift).
3. **Advance the cutoff watermark:** update `fork/UPSTREAM_CUTOFF` to the reviewed `upstream/main` commit SHA and
   document any ported features in `FORK.md` in the same commit.
4. **Verify & ship:**
   - `pnpm check:changed --base=origin/main --maxWorkers=2 --timeout=120` (and `--base=$(cat fork/UPSTREAM_CUTOFF)` when touching shared/fork baselines).
   - `config/scripts/fork.sh build`, then (after quitting Orca) `config/scripts/fork.sh install`.
   - Rebuild/reinstall the Android app (`fork.sh mobile-build` + `fork.sh mobile-install`) whenever native Expo/Android code changes; web-shell screen updates under `/h/[hostId]/*` bundle automatically inside desktop `fork.sh build`.
5. **Compatibility notes:**
   - Because desktop and mobile APKs are built together from this repo, direct LAN/Tailscale mobile control stays self-contained; watch upstream cloud-relay / protocol changes only if using stablyai's cloud relay.
   - `src/shared/rpc-contract/rpc-params-catalog.generated.ts`: always regenerate via `pnpm run generate:rpc-params-catalog`; never hand-edit.
   - Comments starting with `Fork:` in upstream-origin files mark fork-owned hooks so they remain easy to locate.
