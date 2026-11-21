---
name: agent-delegation
description: >-
  Hand parts of a task to other coding agents (Antigravity, Kiro, Codex, Claude) as Orca
  workers, on whichever saved account has usage left, then verify their work. Use when the
  user asks to delegate, offload, "let Kiro/Antigravity do it", spread work across agents or
  accounts, save your own usage, or when your own plan is running low on a long task. Also use
  when a delegated worker ran out of usage and the work needs to move to another account, and
  whenever a prompt carries an "[Orca auto-delegation" note telling you to delegate.
---

# Agent delegation (Orca fork)

You stay the coordinator: you plan, split the work, hand self-contained pieces to other
agents running as Orca workers, then check what they did. Orca tracks every agent's saved
accounts and their usage, and can start a worker on a specific account.

In Orca, each prompt may carry an "[Orca auto-delegation ...]" note from the user's hook: your
own usage, the workers with quota, and whether to delegate by default. Follow it without asking
the user: delegate every task that creates or changes files, runs tests, or needs research or
review, even a small one; do it yourself only for a direct answer, a one-line change, or when the
user says to. If you are an Orca worker yourself (your prompt is a coordinator's brief),
never delegate further.

This builds on Orca orchestration. Before your first worker, load its guide once:
`ORCA skills get orchestration` (worker protocol, waking, `send`, recovery).

## Resolve the CLI

Use `ORCA_CLI_COMMAND` if it is set; otherwise `orca-dev` when `ORCA_DEV_REPO_ROOT` is set;
otherwise `orca`. `ORCA` below stands for that executable. If it cannot run, report the error
and stop.

## 1. Check usage and pick a route

```text
ORCA delegation route [--kind <kind>] [--agent <agent>]
```

It refreshes usage, applies the user's preferences (agent order, model per agent, usage
threshold, named kinds such as `review` or `research`), and prints the `--agent`, `--account`
and `--model` flags for the best route plus fallbacks. Exit code 1 means every account is
exhausted: tell the user, with the reset times from `ORCA delegation usage`.

- `ORCA delegation usage` lists every account and how much of its plan is used. Check your
  own agent's row too: when your account is above about 70%, delegate the bulk work and keep
  planning and verification for yourself.
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

- `--account` takes an id or email from `delegation usage`, `system`, or `auto` (least-used
  account under the threshold). Antigravity and Kiro workers get a private login for that
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
