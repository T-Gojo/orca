---
name: agent-delegation
description: >-
  Hand parts of a task to other coding agents (Antigravity, Kiro, Codex, Claude) as Orca
  workers, on whichever saved account has usage left, then verify their work. Use when the
  user asks to delegate, offload, "let Kiro/Antigravity do it", spread work across agents or
  accounts, save your own usage, or when your own plan is running low on a long task. Also use
  when a delegated worker ran out of usage and the work needs to move to another account, and
  whenever a prompt carries an "[Orca usage brief" note.
---

# Agent delegation (Orca fork)

You stay the coordinator: you plan, split the work, hand self-contained pieces to other
agents running as Orca workers, then check what they did. Orca tracks every agent's saved
accounts and their usage, and can start a worker on a specific account.

In Orca, each prompt carries an "[Orca usage brief ...]" from the user's hook: your own 5h and
weekly usage and pace, each worker agent's best accounts with reset clocks, quota that would reset
unused, each agent's tier, and the best light and strong route. The user's goal is to run long
sessions that use every account's quota (5h and weekly) before it resets, without the work
suffering. Act on it with judgment and never ask the user first. If you are an Orca worker yourself
(your prompt is a coordinator's brief), never delegate further.

## Deciding who does what

Decide per task, not by rule:

- **Delegate** self-contained work you can brief in a few paragraphs: a feature, tests, a
  refactor, research or a code search, a review, docs, bulk edits. Split independent pieces across
  workers in parallel.
- **Match difficulty to tier.** light (Antigravity, Gemini Flash): well-scoped edits, boilerplate,
  tests from a clear spec, docs, search, summaries. standard (Kiro): ordinary features and
  refactors. strong (Codex, Claude on another account): hard bugs, multi-file design, subtle
  concurrency or security, reviews. When unsure, go one tier up. Give light workers tighter
  specs: exact files, signatures and the commands that prove it.
- **Do it yourself** when it is quick to do, depends on what you and the user discussed, needs a
  tight edit-run-debug loop, is tangled with what you are already changing, or a worker failed at
  it twice. Fix small review findings yourself rather than sending them back.
- **Mix**: keep the delicate core for yourself and hand the surrounding pieces to workers at the
  same time.
- **Spend what expires.** Prefer accounts whose quota "resets unused", including your own: if the
  brief says yours resets unused, keep working yourself in parallel with workers. If the brief
  says you are short on quota, delegate everything that can be briefed and keep planning, the
  delicate core and verification.

This builds on Orca orchestration. Before your first worker, load its guide once:
`ORCA skills get orchestration` (worker protocol, waking, `send`, recovery).

## Resolve the CLI

Use `ORCA_CLI_COMMAND` if it is set; otherwise `orca-dev` when `ORCA_DEV_REPO_ROOT` is set;
otherwise `orca`. `ORCA` below stands for that executable. If it cannot run, report the error
and stop.

## 1. Check usage and pick a route

```text
ORCA delegation route --tier light|standard|strong [--agent <agent>] [--kind <kind>]
```

The brief's "Best" line is usually enough for one task. For several tasks, or when the brief is
older, run `route`: it refreshes usage and prints the `--agent`, `--account` and `--model` flags of
the best account for that tier, plus fallbacks. Give parallel workers different accounts (take the
fallbacks in order). It never picks your own Claude account. Exit code 1 means no account of that
tier is left: try the next tier up, or do it yourself.

- `ORCA delegation usage` lists every account with all its windows and reset times.
- Another of the user's Claude accounts is a strong worker: `--agent claude --account <id|email>`.
- Respect a model or agent the user named over the route.
- `ORCA delegation preferences` shows the preferences file; edit it only when the user asks.

## 2. Write a self-contained task spec

Workers start with none of your context. Write the spec to a file with your file tool (never a
heredoc) and include: the goal, the files and constraints, what the worker may and may not
change, how to prove it is done (commands to run, expected output), and "report the evidence
with worker_done". One focused task per worker; split large work.

## 3. Start the worker on the routed account

```text
ORCA orchestration worker-start --environment local --worktree current --agent <agent> --account <account> [--model <model>] --spec-file <task.md>
```

- `--account` takes an id or email from `delegation usage`, `system`, or `auto` (the account
  `route` would pick). Antigravity and Kiro workers get a private login for that
  account, so they run in parallel without changing the login other sessions use.
- `--account` needs an existing workspace (`--worktree current` or an exact one), not
  `new-child`/`new-top-level`.
- Start independent workers together (up to about 4). Then start ONE background command (in
  Claude Code: Bash with `run_in_background`) that returns when a worker reports, and end your
  turn; you are notified when it exits:

  ```text
  ORCA orchestration check --run <run_id> --types worker_done,escalation,decision_gate --wait --timeout-ms 3600000
  ```

  The start receipt names the Run. The command marks what it returns as read, so act on every
  message it prints, then start it again while workers are still running. If it timed out with
  nothing, start it again. Orca may also type a wake-up note into your pane; if it does, still
  read mail with this command. Never poll in the foreground.

## Coordinating from another CLI (codex, kiro, vibe, opencode, antigravity)

The same kit installs for all of them. No background-command notification: the wait is a FOREGROUND
`ORCA orchestration check --run <id> --types worker_done,escalation,decision_gate --wait
--timeout-ms 3600000` once per turn — run it, act on everything it returns, rerun until it returns
nothing, then answer the user and keep working in the same turn.

## 4. Verify, then retry or report

When a worker reports `worker_done`:

1. Check the evidence yourself: read the diff (`git diff`), run the tests or commands the spec
   named. Never accept a report without looking at the change.
2. Fix-ups go back to the same worker with
   `ORCA orchestration send --to dispatch:<id> --subject "Fix" --body-file <file>`.
3. If a worker stopped because its account hit a usage or quota limit, start the same task on
   the next route (`ORCA delegation route --agent <agent>` or another agent's fallback) with
   `--retry-of <dispatch_id> --task <task_id>`.
4. Report to the user per task: which agent and account did it, the outcome, the evidence.
