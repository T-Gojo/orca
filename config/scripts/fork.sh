#!/usr/bin/env bash
# Personal-fork workflow. All work lives on `main`, which merges stablyai/orca (`upstream`) in.
#
#   config/scripts/fork.sh sync   # merge upstream into main, push main, reinstall deps
#   config/scripts/fork.sh dev      # run the custom build side by side with the installed Orca.app
#   config/scripts/fork.sh build    # package Orca.app (macOS) from the current checkout into dist/
#   config/scripts/fork.sh install  # replace /Applications/Orca.app with that build (quit Orca first)
set -euo pipefail

FORK_BRANCH="${ORCA_FORK_BRANCH:-main}"
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
  git switch "$FORK_BRANCH"
  if ! git merge --no-edit upstream/main; then
    echo
    echo "Merge conflicts with upstream. Resolve them, then run:"
    echo "  git add <files> && git commit && git push origin $FORK_BRANCH && pnpm install"
    echo "(rerere is on, so git will remember each resolution next time.)"
    exit 1
  fi
  git push origin "$FORK_BRANCH"
  pnpm install
}

dev() {
  pnpm dev "$@"
}

APP_PATH="/Applications/Orca.app"
BACKUP_DIR="$HOME/Library/Application Support/orca-fork"
SIGNING_DIR="$BACKUP_DIR/signing"
SIGNING_KEYCHAIN="$SIGNING_DIR/orca-fork-signing.keychain-db"
SIGNING_NAME="Orca Fork Local Signing"

# Why a stable identity: macOS keys Screen Recording and Accessibility grants to the signature.
# An ad-hoc signature changes with every build, so each install asked for permission again.
find_signing_identity() {
  security find-identity "$SIGNING_KEYCHAIN" 2>/dev/null |
    awk -v name="\"$SIGNING_NAME\"" 'index($0, name) { print $2; exit }'
}

create_signing_identity() {
  local pass_file="$1" work
  work="$(mktemp -d)"
  rm -f "$SIGNING_KEYCHAIN"
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 >"$pass_file" || true
  chmod 600 "$pass_file"
  cat >"$work/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$SIGNING_NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
  openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  # Why these algorithms: macOS `security import` cannot read OpenSSL 3's default PKCS#12.
  openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -out "$work/id.p12" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:import
  security create-keychain -p "$(cat "$pass_file")" "$SIGNING_KEYCHAIN"
  security set-keychain-settings "$SIGNING_KEYCHAIN"
  security unlock-keychain -p "$(cat "$pass_file")" "$SIGNING_KEYCHAIN"
  security import "$work/id.p12" -k "$SIGNING_KEYCHAIN" -P import -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "$(cat "$pass_file")" \
    "$SIGNING_KEYCHAIN" >/dev/null
  rm -rf "$work"
}

# Why a stable identity: macOS keys Screen Recording and Accessibility grants to the signature.
# An ad-hoc signature changes with every build, so each install asked for permission again.
signing_identity() {
  mkdir -p "$SIGNING_DIR"
  chmod 700 "$SIGNING_DIR"
  local pass_file="$SIGNING_DIR/keychain-password"
  if [[ -f "$SIGNING_KEYCHAIN" && -f "$pass_file" ]]; then
    security unlock-keychain -p "$(cat "$pass_file")" "$SIGNING_KEYCHAIN" 2>/dev/null || true
  fi
  if [[ -z "$(find_signing_identity)" ]]; then
    create_signing_identity "$pass_file" >&2
  fi
  find_signing_identity
}

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
  local identity
  identity="$(signing_identity)"
  if [[ -z "$identity" ]]; then
    echo "Could not create the local signing identity in $SIGNING_KEYCHAIN" >&2
    exit 1
  fi
  # Why first: --deep skips Contents/Resources, where the Computer Use helper that asks for
  # Screen Recording lives; the outer seal must then cover the re-signed helper.
  local helper
  while IFS= read -r -d '' helper; do
    codesign --force --deep --sign "$identity" --keychain "$SIGNING_KEYCHAIN" "$helper"
  done < <(find "$(built_app)/Contents/Resources" -maxdepth 1 -name '*.app' -print0)
  codesign --force --deep --sign "$identity" --keychain "$SIGNING_KEYCHAIN" "$(built_app)"
  codesign --verify --deep --strict "$(built_app)"
  echo "Built $(built_app)"
}

install_app() {
  local app
  app="$(built_app)"
  if [[ ! -d "$app" ]]; then
    echo "No build at $app; run: $0 build" >&2
    exit 1
  fi
  # Why anchored: the terminal daemon names the app executable in its arguments and may keep running.
  # Why -a: without it macOS pgrep skips ancestors, so a run from an Orca terminal missed Orca.
  if pgrep -af "^$APP_PATH/Contents/MacOS/Orca( |\$)" >/dev/null; then
    echo "Orca is running. Quit it (Cmd+Q) and run this again." >&2
    exit 1
  fi
  # Why .noindex: Spotlight skips it, so the saved official app is not listed beside the real one.
  local official_backup="$BACKUP_DIR/backups.noindex/Orca-official.app"
  if [[ -d "$APP_PATH" ]] &&
    ! defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString | grep -q -- '-custom\.'; then
    mkdir -p "$(dirname "$official_backup")"
    rm -rf "$official_backup"
    ditto "$APP_PATH" "$official_backup"
    echo "Official app saved to $official_backup"
  fi
  rm -rf "$APP_PATH"
  ditto "$app" "$APP_PATH"
  # The build is only a staging copy; left in dist/ it shows up as a second Orca in Spotlight.
  rm -rf "$app"
  # Why: a pinned Dock tile keeps following the replaced bundle, so clicks on it stop activating
  # the new app until LaunchServices and the Dock pick up the new bundle.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"
  killall Dock 2>/dev/null || true
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
