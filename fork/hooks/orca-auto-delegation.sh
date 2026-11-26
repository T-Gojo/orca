#!/bin/sh
# Fork (FORK.md §8): UserPromptSubmit hook for every coordinator CLI (Claude Code settings.json,
# Codex ~/.codex/hooks.json, Kiro ~/.kiro/hooks/orca-auto-delegation.json; ORCA_DELEGATION_AGENT
# names the CLI, default claude). In an Orca terminal it adds the `orca delegation advice` note
# (workers with quota, delegate by default) to each prompt.
# Note (§16): Rikugan is strictly on-demand — never auto-queried here unless explicitly asked via MCP.
input=$(cat)
[ -n "${ORCA_PANE_KEY-}${ORCA_AGENT_PANE-}" ] || exit 0
[ -z "${ORCA_DELEGATION_WORKER-}" ] || exit 0
[ "${ORCA_AUTO_DELEGATION-}" != off ] || exit 0

# A worker started without --account has no env marker: remember its session from the dispatch brief.
# Key by the payload's session_id when present; CLIs whose payload has none key by the Orca pane.
marks="${TMPDIR:-/tmp}/orca-delegation-workers"
session=$(printf '%s' "$input" | grep -o '"session_id" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
key="${session:-${ORCA_PANE_KEY:-}}"
case "$input" in
  *"Please carry out this task from my Orca coordinator"* | *"You are working inside Orca, a multi-agent IDE."*)
    [ -n "$key" ] && { mkdir -p "$marks" && : >"$marks/$key"; }
    exit 0
    ;;
esac
[ -z "$key" ] || [ ! -f "$marks/$key" ] || exit 0

cli=${ORCA_CLI_COMMAND-}
if [ -z "$cli" ]; then
  if [ -n "${ORCA_DEV_REPO_ROOT-}" ] && command -v orca-dev >/dev/null 2>&1; then cli=orca-dev; else cli=orca; fi
fi
agent="${ORCA_DELEGATION_AGENT:-claude}"
# Word splitting is intended: ORCA_CLI_COMMAND may carry its own arguments.
# An older CLI without --session still gets the full brief.
$cli delegation advice --agent "$agent" ${key:+--session "$key"} 2>/dev/null ||
  $cli delegation advice --agent "$agent" 2>/dev/null
exit 0
