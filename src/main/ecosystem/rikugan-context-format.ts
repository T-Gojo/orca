/** Fork: Rikugan context formatting, prompt filtering, secret scrubbing & session recall state (§16). */

const TRIVIAL_PROMPT_RE =
  /^(?:ok|okay|k|thanks|thank you|thx|got it|cool|nice|yes|yep|no|nope|done|\/\w+)[.!?]*$/i

const SECRET_SCRUB_RE =
  /\b(?:rkg_[A-Za-z0-9_-]{12,}|sbk_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|orca_eco_[a-f0-9]{20,}|\d{6})\b/g

export type SessionRecallState = {
  seenIds: Set<string>
  briefSent: boolean
  turns: number
  recorded: boolean
}

const sessionStates = new Map<string, SessionRecallState>()
let lastContextLatencyMs: number | null = null
let recordedSessionsCount = 0

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clipRikuganText(value: unknown, limit: number): string {
  const clean = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

export function scrubSecretsForRikugan(text: string): string {
  return text.replace(SECRET_SCRUB_RE, '[REDACTED]')
}

export function isTrivialRikuganPrompt(prompt: string): boolean {
  const trimmed = prompt.trim()
  return trimmed.length < 3 || TRIVIAL_PROMPT_RE.test(trimmed)
}

export function getRikuganSessionState(sessionId: string): SessionRecallState {
  let state = sessionStates.get(sessionId)
  if (!state) {
    if (sessionStates.size > 250) {
      const oldest = sessionStates.keys().next().value
      if (oldest) {
        sessionStates.delete(oldest)
      }
    }
    state = { seenIds: new Set<string>(), briefSent: false, turns: 0, recorded: false }
    sessionStates.set(sessionId, state)
  }
  return state
}

export function recordRikuganContextLatency(ms: number): void {
  lastContextLatencyMs = ms
}

export function incrementRecordedRikuganSessions(): void {
  recordedSessionsCount += 1
}

export function getRikuganRuntimeCounters(): {
  lastContextMs: number | null
  recordedSessions: number
} {
  return { lastContextMs: lastContextLatencyMs, recordedSessions: recordedSessionsCount }
}

export function resetRikuganSessionStateForTests(): void {
  sessionStates.clear()
  lastContextLatencyMs = null
  recordedSessionsCount = 0
}

export function formatRikuganContextResult(
  result: unknown,
  options: { includeBrief: boolean; seenIds: Set<string>; maxChars?: number }
): { text: string; itemCount: number } {
  if (!isPlainRecord(result)) {
    return { text: '', itemCount: 0 }
  }
  const lines: string[] = []
  let itemCount = 0
  if (options.includeBrief && typeof result.brief === 'string' && result.brief.trim()) {
    lines.push(result.brief.trim())
  }
  const addSection = (
    title: string,
    rawItems: unknown,
    render: (item: Record<string, unknown>) => string
  ) => {
    if (!Array.isArray(rawItems)) {
      return
    }
    const fresh = rawItems.filter(
      (item): item is Record<string, unknown> =>
        isPlainRecord(item) && typeof item.id === 'string' && !options.seenIds.has(item.id)
    )
    if (fresh.length === 0) {
      return
    }
    lines.push(`${title}:`)
    for (const item of fresh) {
      const id = String(item.id)
      options.seenIds.add(id)
      lines.push(`- ${render(item)}`)
      itemCount += 1
    }
  }
  addSection(
    'Standing instructions and preferences',
    result.preferences,
    (n) => `${clipRikuganText(n.statement, 280)} [${String(n.id)}]`
  )
  addSection('Facts', result.facts, (n) => `${clipRikuganText(n.statement, 280)} [${String(n.id)}]`)
  addSection(
    'People and organisations',
    result.people,
    (n) =>
      `${clipRikuganText(n.label, 80)} (${clipRikuganText(n.type, 40)}): ${clipRikuganText(n.summary, 180)} [${String(n.id)}]`
  )
  addSection('Related records', result.recent, (n) =>
    `${clipRikuganText(n.day, 16)} ${clipRikuganText(n.label, 100)}: ${clipRikuganText(n.snippet, 220)} [${String(n.id)}]`.trim()
  )
  addSection(
    'Earlier agent sessions',
    result.sessions,
    (n) =>
      `${clipRikuganText(n.label ?? n.title, 140)}: ${clipRikuganText(n.summary, 260)} [${String(n.id)}]`
  )
  if (lines.length === 0) {
    return { text: '', itemCount: 0 }
  }
  const header = "From Rikugan, the owner's knowledge hub (cite [ids] when using records):\n"
  const joined = `${header}${lines.join('\n')}`
  const maxChars = options.maxChars ?? 5_000
  return {
    text: joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1)}…`,
    itemCount
  }
}
