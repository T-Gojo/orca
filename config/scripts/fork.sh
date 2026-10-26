#!/usr/bin/env bash
# Personal-fork workflow. `main` mirrors stablyai/orca; custom work lives on `custom`.
#
#   config/scripts/fork.sh sync   # pull upstream into main, merge main into custom, push both, reinstall deps
#   config/scripts/fork.sh dev      # run the custom build side by side with the installed Orca.app
#   config/scripts/fork.sh build    # package Orca.app (macOS) from the current checkout into dist/
#   config/scripts/fork.sh install  # replace /Applications/Orca.app with that build (quit Orca first)
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

APP_PATH="/Applications/Orca.app"
BACKUP_DIR="$HOME/Library/Application Support/orca-fork"

built_app() {
  local arch
  arch="$([[ "$(uname -m)" == arm64 ]] && echo mac-arm64 || echo mac)"
  echo "$REPO_ROOT/dist/$arch/Orca.app"
}

# Why ahead of every known release: Orca must not read this build as older than the one it replaces.
custom_version() {
  local latest major minor patch
  latest="$(
    {
      git ls-remote --tags --refs upstream 'v*' 2>/dev/null | sed -E 's#.*/v##' || true
      defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true
      node -p "require('./package.json').version"
    } | sed -E 's/[-+].*$//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' |
      sort -t. -k1,1n -k2,2n -k3,3n | tail -1
  )"
  IFS=. read -r major minor patch <<<"$latest"
  echo "$major.$minor.$((patch + 1))-custom.$(date +%Y%m%d%H%M).g$(git rev-parse --short=12 HEAD)"
}

build() {
  if [[ "$(uname)" != Darwin ]]; then
    echo "build/install currently support macOS only." >&2
    exit 1
  fi
  local version arch
  version="$(custom_version)"
  arch="$([[ "$(uname -m)" == arm64 ]] && echo --arm64 || echo --x64)"
  echo "Building Orca $version"
  # mobile/ is its own workspace; the desktop app bundles its web build.
  (cd mobile && pnpm install --frozen-lockfile)
  pnpm run build:desktop
  pnpm run build:computer-macos
  pnpm run build:keyboard-layout-macos
  pnpm run build:notification-status-macos
  pnpm run ensure:electron-runtime
  # Why ad-hoc: a stray keychain certificate would otherwise be picked up and need Apple's timestamp server.
  CSC_IDENTITY_AUTO_DISCOVERY=false ORCA_BUILD_COMMIT="$(git rev-parse --short=12 HEAD)" \
    ORCA_LOCAL_BUILD_VERSION="$version" \
    pnpm exec electron-builder --config config/electron-builder.config.cjs --mac dir "$arch"
  codesign --force --deep --sign - "$(built_app)"
  echo "Built $(built_app)"
}

install_app() {
  local app
  app="$(built_app)"
  if [[ ! -d "$app" ]]; then
    echo "No build at $app; run: $0 build" >&2
    exit 1
  fi
  if pgrep -f "$APP_PATH/Contents/MacOS/Orca" >/dev/null; then
    echo "Orca is running. Quit it (Cmd+Q) and run this again." >&2
    exit 1
  fi
  mkdir -p "$BACKUP_DIR"
  if [[ -d "$APP_PATH" ]]; then
    rm -rf "$BACKUP_DIR/Orca-previous.app"
    mv "$APP_PATH" "$BACKUP_DIR/Orca-previous.app"
    echo "Previous app saved to $BACKUP_DIR/Orca-previous.app"
  fi
  ditto "$app" "$APP_PATH"
  echo "Installed $(defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString) to $APP_PATH"
}

case "${1:-}" in
  sync) sync ;;
  dev) shift; dev "$@" ;;
  build) build ;;
  install) install_app ;;
  *)
    echo "usage: $0 {sync|dev|build|install}" >&2
    exit 2
    ;;
esac
