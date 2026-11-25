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
  `use-status-bar-controller.ts`).
- **Terminals:** Claude and Codex terminals can open on a chosen account. The pin env lives in
  `src/shared/agent-terminal-account-pin.ts`; the spawn-side hooks are `claude-accounts/claude-terminal-account-pin.ts`,
  `codex-accounts/runtime-home/routing/runtime-home-service-launch.ts` and `codex/configuration/homes/codex-pane-account-registry*`,
  plus the right-click "Change account" menu in `ChangeAccountMenuItems.tsx`.

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
  `userData/orca-delegation.json` (`agentOrder`, `models`, `maxUsedPercent`, `kinds`, `profiles`, `autoDelegation`; defaults
  written on first use).
- **Auto-delegation (on by default):** `fork/hooks/orca-auto-delegation.sh` is a Claude Code
  `UserPromptSubmit` hook (registered in `~/.claude/settings.json` by `fork.sh install` or
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
    antigravity light, kiro standard, codex and claude strong), quota that resets unused first, then
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
  notification wakes it. Upstream's pane wake-up (typing a note into the coordinator's prompt) did not
  fire in the hidden dev test window, where CLI-created terminals are "orphaned" (no UI tab); the
  background wait does not depend on it.
- **Skill:** `fork/skills/agent-delegation/SKILL.md`, installed to `~/.claude/skills` by
  `fork.sh install` (or `fork.sh skills`). Kept out of upstream's bundled-skill generator on purpose.
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
   - `src/main/ipc/pty/*` or wherever the terminal account pins move to upstream
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
