#!/usr/bin/env bash
# Personal-fork workflow. `main` mirrors stablyai/orca; custom work lives on `custom`.
#
#   config/scripts/fork.sh sync   # pull upstream into main, merge main into custom, push both, reinstall deps
#   config/scripts/fork.sh dev    # run the custom build side by side with the installed Orca.app
set -euo pipefail

CUSTOM_BRANCH="${ORCA_FORK_BRANCH:-custom}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# package.json pins Node 24; prefer Homebrew's node@24 over a newer default node.
for node24 in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
  if [[ -x "$node24/node" ]]; then
    export PATH="$node24:$PATH"
    break
  fi
done

sync() {
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Working tree has uncommitted changes; commit or stash them first." >&2
    exit 1
  fi

  git fetch upstream
  if [[ "$(git branch --show-current)" == main ]]; then
    git merge --ff-only upstream/main
  else
    git fetch . upstream/main:main
  fi
  git push origin main

  git switch "$CUSTOM_BRANCH"
  if ! git merge --no-edit main; then
    echo
    echo "Merge conflicts with upstream. Resolve them, then run:"
    echo "  git add <files> && git commit && git push origin $CUSTOM_BRANCH && pnpm install"
    echo "(rerere is on, so git will remember each resolution next time.)"
    exit 1
  fi
  git push origin "$CUSTOM_BRANCH"
  pnpm install
}

dev() {
  pnpm dev "$@"
}

case "${1:-}" in
  sync) sync ;;
  dev) shift; dev "$@" ;;
  *)
    echo "usage: $0 {sync|dev}" >&2
    exit 2
    ;;
esac
