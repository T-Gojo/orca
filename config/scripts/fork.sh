#!/usr/bin/env bash
# Personal-fork workflow. All work lives on `main` (origin = T-Gojo/orca).
# Upstream (`stablyai/orca`) is tracked selectively from the watermark in `fork/UPSTREAM_CUTOFF`.
#
#   config/scripts/fork.sh upstream-check # fetch upstream and list commits since fork/UPSTREAM_CUTOFF
#   config/scripts/fork.sh sync           # legacy: full merge of upstream/main into main
#   config/scripts/fork.sh dev            # run the custom build side by side with the installed Orca.app
#   config/scripts/fork.sh build          # package Orca.app (macOS) from the current checkout into dist/
#   config/scripts/fork.sh install        # replace /Applications/Orca.app with that build (quit Orca first)
#   config/scripts/fork.sh skills         # install the fork's agent skills (fork/skills) for every CLI
#   config/scripts/fork.sh hooks          # install the auto-delegation hooks (fork/hooks: Claude Code,
#                                         # Codex and Kiro; Antigravity/Vibe/OpenCode have no hook yet)
#   config/scripts/fork.sh mcp            # configure browser-use, dusk, and computer-use MCP for all 6 CLIs
#   config/scripts/fork.sh mobile-build   # build standalone Android release APK (arm64-v8a by default)
#   config/scripts/fork.sh mobile-install # install built Android APK over ADB (--serial <id>, --remove-old)
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
    echo "See FORK.md for what the fork changes and how to keep it on top of upstream."
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
  install_fork_skills
  install_fork_hooks
  install_fork_mcp
}

# Adds a UserPromptSubmit group (Claude-shaped hooks file) filtered-and-appended: every previous
# orca-auto-delegation group is dropped first, so Orca's own entries and their positional trust
# state (~/.codex/config.toml `user_prompt_submit:0:0`) keep their indices.
merge_user_prompt_submit() {
  local file="$1" command="$2"
  node - "$file" "$command" <<'NODE'
const fs = require('node:fs')
const [file, command] = process.argv.slice(2)
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const hooks = (settings.hooks ??= {})
const kept = (hooks.UserPromptSubmit ?? []).filter(
  (group) => !(group.hooks ?? []).some((h) => String(h.command).includes('orca-auto-delegation'))
)
kept.push({ hooks: [{ type: 'command', command, timeout: 8 }] })
hooks.UserPromptSubmit = kept
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
NODE
}

# `skill_paths` (verified top-level array key via `vibe config schema`) points vibe at extra skill
# dirs; a plain ~/.vibe/skills is not autoloaded. Appends only when absent, inserted before the
# first [table] header so the key can never land inside a table.
ensure_vibe_skill_paths() {
  local config="$HOME/.vibe/config.toml" dir="$HOME/.vibe/skills"
  mkdir -p "$HOME/.vibe"
  node - "$config" "$dir" <<'NODE'
const fs = require('node:fs')
const [file, dir] = process.argv.slice(2)
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
if (text.trim() === '') {
  fs.writeFileSync(file, `skill_paths = ["${dir}"]\n`)
  console.log(`Added skill_paths to ${file}`)
  process.exit(0)
}
const lines = text.split('\n')
let insertAt = null
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  if (/^\s*\[/.test(line)) {
    if (insertAt === null) insertAt = i
  } else if (insertAt === null && /^\s*skill_paths\s*=/.test(line)) {
    console.log(`skill_paths already present in ${file}`)
    process.exit(0)
  }
}
if (insertAt === null && lines[lines.length - 1] === '') insertAt = lines.length - 1
lines.splice(insertAt ?? lines.length, 0, `skill_paths = ["${dir}"]`)
let out = lines.join('\n')
if (!out.endsWith('\n')) out += '\n'
fs.writeFileSync(file, out)
console.log(`Added skill_paths to ${file}`)
NODE
}

# Registers the auto-delegation hook (FORK.md §8) for every coordinator CLI, next to Orca's own hooks.
install_fork_hooks() {
  local hook_repo="$REPO_ROOT/fork/hooks/orca-auto-delegation.sh" hook
  # Claude Code (agent defaults to claude, so the settings entry needs no env prefix).
  local claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  mkdir -p "$claude_dir/hooks"
  hook="$claude_dir/hooks/orca-auto-delegation.sh"
  cp "$hook_repo" "$hook"
  chmod +x "$hook"
  merge_user_prompt_submit "$claude_dir/settings.json" "/bin/sh \"$hook\""
  echo "Installed auto-delegation hook in $claude_dir/settings.json"
  # Codex: merged into Orca-managed ~/.codex/hooks.json (filter-and-append keeps Orca's groups first).
  # Codex does not trust our new group automatically (trusted_hash not scriptable) - its one-time
  # trust prompt runs on the first prompt. See FORK.md §8.
  local codex_dir="$HOME/.codex"
  mkdir -p "$codex_dir/hooks"
  hook="$codex_dir/hooks/orca-auto-delegation.sh"
  cp "$hook_repo" "$hook"
  chmod +x "$hook"
  merge_user_prompt_submit "$codex_dir/hooks.json" "ORCA_DELEGATION_AGENT=codex /bin/sh \"$hook\""
  echo "Installed auto-delegation hook in $codex_dir/hooks.json (let codex's trust prompt run once)"
  # Kiro: standalone hook file, mirroring Orca's own ~/.kiro/hooks/orca-agent-status.json shape.
  local kiro_dir="$HOME/.kiro"
  mkdir -p "$kiro_dir/hooks"
  hook="$kiro_dir/hooks/orca-auto-delegation.sh"
  cp "$hook_repo" "$hook"
  chmod +x "$hook"
  node - "$kiro_dir/hooks/orca-auto-delegation.json" "$hook" <<'NODE'
const fs = require('node:fs')
const [file, hook] = process.argv.slice(2)
// Mirrors Orca's own orca-agent-status.json entry: pane guard, file checks, stdin drain fallback.
const guard = '[ -n "${ORCA_PANE_KEY-}${ORCA_AGENT_PANE-}" ] || exit 0; ' +
  `if [ -f '${hook}' ] && [ -r '${hook}' ] && [ -x '${hook}' ]; then ` +
  `ORCA_DELEGATION_AGENT=kiro /bin/sh '${hook}'; ` +
  'else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi'
fs.writeFileSync(file, JSON.stringify({
  version: 'v1',
  hooks: [{
    name: 'orca-auto-delegation-UserPromptSubmit',
    trigger: 'UserPromptSubmit',
    action: { type: 'command', command: guard },
    timeout: 8
  }]
}, null, 2) + '\n')
NODE
  echo "Installed auto-delegation hook in $kiro_dir/hooks/orca-auto-delegation.json"
}

# Fork-only agent skills (fork/skills/<name>/SKILL.md) go to every coordinator CLI's skills dir.
install_fork_skills() {
  local homes=(
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
    "$HOME/.codex/skills"
    "$HOME/.kiro/skills"
    "$HOME/.gemini/skills"
    "$HOME/.config/opencode/skills"
    "$HOME/.vibe/skills"
  )
  local skill home
  for skill in "$REPO_ROOT"/fork/skills/*/; do
    [[ -f "$skill/SKILL.md" ]] || continue
    for home in "${homes[@]}"; do
      mkdir -p "$home/$(basename "$skill")"
      cp -R "$skill". "$home/$(basename "$skill")/"
      echo "Installed skill $(basename "$skill") to $home"
    done
  done
  ensure_vibe_skill_paths
}

# Installs/upgrades browser-use[cli] and registers browser-use, dusk, and computer-use MCP across all 6 CLIs.
install_fork_mcp() {
  if command -v uv >/dev/null 2>&1 && [[ "${ORCA_SKIP_BROWSER_USE_UPGRADE:-0}" != "1" ]]; then
    if ! uv tool install --upgrade "browser-use[cli]"; then
      echo "Warning: failed to upgrade browser-use[cli] (offline?); continuing with existing install." >&2
    fi
  fi
  node "$REPO_ROOT/fork/scripts/install-browser-use-mcp.mjs"
}

ANDROID_RELEASE_APK="$REPO_ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk"

configure_android_env() {
  export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  if [[ -d "$ANDROID_HOME/platform-tools" ]]; then
    export PATH="$ANDROID_HOME/platform-tools:$PATH"
  fi
  local java17=""
  for candidate in \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home; do
    if [[ -x "$candidate/bin/java" ]]; then
      java17="$candidate"
      break
    fi
  done
  if [[ -z "$java17" && -x /usr/libexec/java_home ]]; then
    java17="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  fi
  if [[ -n "$java17" ]]; then
    export JAVA_HOME="$java17"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
}

upstream_check() {
  local cutoff_file="$REPO_ROOT/fork/UPSTREAM_CUTOFF"
  if [[ ! -f "$cutoff_file" ]]; then
    echo "Missing $cutoff_file; record the last reviewed upstream/main SHA there." >&2
    exit 1
  fi
  local cutoff
  cutoff="$(tr -d '[:space:]' <"$cutoff_file")"
  git fetch upstream
  local head_sha count
  head_sha="$(git rev-parse --short=12 upstream/main)"
  count="$(git rev-list --count --no-merges "$cutoff..upstream/main")"
  echo "Upstream cutoff: ${cutoff:0:12} -> upstream/main: $head_sha ($count non-merge commit(s))"
  if [[ "$count" == "0" ]]; then
    echo "No new upstream commits since cutoff."
    return 0
  fi
  echo
  git log --oneline --no-merges "$cutoff..upstream/main"
  echo
  echo "Inspect a commit: git show <sha>"
  echo "Advance cutoff after review: git rev-parse upstream/main > fork/UPSTREAM_CUTOFF"
}

mobile_build() {
  configure_android_env
  (cd mobile && pnpm install --frozen-lockfile && npx expo prebuild --platform android --no-install)
  local gradle_args=(assembleRelease --max-workers=2)
  local archs="${ORCA_ANDROID_ARCHS:-arm64-v8a}"
  if [[ "$archs" != "all" ]]; then
    gradle_args+=("-PreactNativeArchitectures=$archs")
  fi
  (cd mobile/android && ./gradlew "${gradle_args[@]}")
  if [[ ! -f "$ANDROID_RELEASE_APK" ]]; then
    echo "Expected release APK not found at $ANDROID_RELEASE_APK" >&2
    exit 1
  fi
  echo "Built Android release APK:"
  ls -lh "$ANDROID_RELEASE_APK"
}

mobile_install() {
  configure_android_env
  local serial="" remove_old=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --serial)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for --serial" >&2
          exit 2
        fi
        serial="$2"
        shift 2
        ;;
      --remove-old)
        remove_old=1
        shift
        ;;
      *)
        echo "Unknown option for mobile-install: $1" >&2
        echo "usage: $0 mobile-install [--serial <id>] [--remove-old]" >&2
        exit 2
        ;;
    esac
  done
  if [[ ! -f "$ANDROID_RELEASE_APK" ]]; then
    echo "No Android release APK at $ANDROID_RELEASE_APK; run: $0 mobile-build" >&2
    exit 1
  fi
  if [[ -z "$serial" ]]; then
    local devices=()
    while IFS= read -r line; do
      [[ -n "$line" ]] && devices+=("$line")
    done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    if [[ ${#devices[@]} -eq 0 ]]; then
      echo "No connected ADB devices found. Connect a phone or pass --serial <id>." >&2
      exit 1
    fi
    if [[ ${#devices[@]} -gt 1 ]]; then
      echo "Multiple ADB devices connected (${devices[*]}). Pass --serial <id>." >&2
      exit 1
    fi
    serial="${devices[0]}"
  fi
  if [[ "$remove_old" == "1" ]]; then
    if adb -s "$serial" shell pm list packages com.stably.orca.mobile | grep -q "package:com.stably.orca.mobile"; then
      echo "Uninstalling old com.stably.orca.mobile on $serial..."
      adb -s "$serial" uninstall com.stably.orca.mobile
    fi
  fi
  echo "Installing $ANDROID_RELEASE_APK to $serial..."
  adb -s "$serial" install -r -d "$ANDROID_RELEASE_APK"
}

case "${1:-}" in
  upstream-check) upstream_check ;;
  sync) sync ;;
  dev) shift; dev "$@" ;;
  build) build ;;
  install) install_app ;;
  skills) install_fork_skills ;;
  hooks) install_fork_hooks ;;
  mcp) install_fork_mcp ;;
  mobile-build) mobile_build ;;
  mobile-install) shift; mobile_install "$@" ;;
  *)
    echo "usage: $0 {upstream-check|sync|dev|build|install|skills|hooks|mcp|mobile-build|mobile-install}" >&2
    exit 2
    ;;
esac
