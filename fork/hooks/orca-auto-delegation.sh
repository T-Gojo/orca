#!/bin/sh
# Fork (FORK.md §8): Claude Code UserPromptSubmit hook. In an Orca terminal it adds the
# `orca delegation advice` note (workers with quota, delegate by default) to each prompt.
input=$(cat)
[ -n "${ORCA_PANE_KEY-}${ORCA_AGENT_PANE-}" ] || exit 0
[ -z "${ORCA_DELEGATION_WORKER-}" ] || exit 0
[ "${ORCA_AUTO_DELEGATION-}" != off ] || exit 0

# A worker started without --account has no env marker: remember its session from the dispatch brief.
marks="${TMPDIR:-/tmp}/orca-delegation-workers"
session=$(printf '%s' "$input" | grep -o '"session_id" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
case "$input" in
  *"Please carry out this task from my Orca coordinator"* | *"You are working inside Orca, a multi-agent IDE."*)
    if [ -n "$session" ]; then mkdir -p "$marks" && : >"$marks/$session"; fi
    exit 0
    ;;
esac
if [ -n "$session" ] && [ -f "$marks/$session" ]; then exit 0; fi

cli=${ORCA_CLI_COMMAND-}
if [ -z "$cli" ]; then
  if [ -n "${ORCA_DEV_REPO_ROOT-}" ] && command -v orca-dev >/dev/null 2>&1; then cli=orca-dev; else cli=orca; fi
fi
# Word splitting is intended: ORCA_CLI_COMMAND may carry its own arguments.
$cli delegation advice --agent claude 2>/dev/null
exit 0
