/** Fork: command-kind duration priors and compact duration formatting for Background Tasks (FORK.md §13). */

const AGENT_DEFAULT_DURATION_MS: Readonly<Record<string, number>> = {
  antigravity: 90_000,
  kiro: 150_000,
  'mistral-vibe': 150_000,
  opencode: 150_000,
  opencode2: 150_000,
  codex: 210_000,
  claude: 210_000,
  'claude-agent-teams': 210_000
}

const DEFAULT_FALLBACK_DURATION_MS = 180_000

const HEAVY_NATIVE_BUILD_RE =
  /\b(ninja|autoninja|gn\s+gen|helium|chromium|xcodebuild|gradlew\s+assemble|cargo\s+build\s+--release|electron-builder|cmake\s+--build|build-macos|build-release|make\s+-j)\b/i
const MEDIA_RENDER_RE = /\b(blender|ffmpeg|remotion|veo|gflow)\b/i
const STANDARD_BUILD_RE =
  /\b(pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(tsc|vite\s+build|next\s+build|gradle|gradlew|cargo\s+build|go\s+build)\b/i
const TEST_SUITE_RE =
  /\b(vitest|jest|pytest|playwright|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test)\b/i
const ORCHESTRATION_WAIT_RE = /\borca\s+orchestration\s+check\b.*--wait/i

export function inferShellCommandPriorMs(command: string | null | undefined): number | null {
  const text = command?.trim()
  if (!text) {
    return null
  }
  if (HEAVY_NATIVE_BUILD_RE.test(text)) {
    return 20 * 60_000
  }
  if (MEDIA_RENDER_RE.test(text)) {
    return 8 * 60_000
  }
  if (STANDARD_BUILD_RE.test(text)) {
    return 4 * 60_000
  }
  if (ORCHESTRATION_WAIT_RE.test(text)) {
    return 210_000
  }
  if (TEST_SUITE_RE.test(text)) {
    return 3 * 60_000
  }
  return 90_000
}

export function normalizeEtaAgentKey(agentType: string | null | undefined): string {
  const normalized = agentType?.trim().toLowerCase() ?? ''
  if (normalized === 'claude-agent-teams') {
    return 'claude'
  }
  if (normalized === 'opencode2') {
    return 'opencode'
  }
  return normalized
}

export function defaultAgentDurationMs(agentType: string | null | undefined): number {
  return AGENT_DEFAULT_DURATION_MS[normalizeEtaAgentKey(agentType)] ?? DEFAULT_FALLBACK_DURATION_MS
}

export function formatDurationCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s'
  }
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}
