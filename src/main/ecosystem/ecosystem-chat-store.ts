import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  EcosystemChatMessageSchema,
  type EcosystemChatMessage
} from '../../shared/ecosystem/ecosystem-types'
import { ecosystemRootDir, ensureEcosystemDirs } from './ecosystem-config'

/** Fork: shared Mac-internal conversation transcript across Desktop, Mobile, WhatsApp & Telegram (§16). */

const ChatHistoryFileSchema = z.object({
  messages: z.array(EcosystemChatMessageSchema).default([])
})

const trackedBotSessions = new Set<string>()
let lastRecordedAssistantDigest = ''

function chatHistoryPath(home: string = homedir()): string {
  return join(ecosystemRootDir(home), 'chat-history.json')
}

export function trackEcosystemBotSession(sessionId: string | null | undefined): void {
  if (sessionId) {
    trackedBotSessions.add(sessionId)
  }
}

export function isTrackedEcosystemBotSession(sessionId: string): boolean {
  return trackedBotSessions.has(sessionId)
}

export async function readEcosystemChatMessages(
  home: string = homedir(),
  limit: number = 60
): Promise<EcosystemChatMessage[]> {
  const raw = await readFile(chatHistoryPath(home), 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }
  try {
    const parsed = ChatHistoryFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.messages.slice(-limit) : []
  } catch {
    return []
  }
}

export async function appendEcosystemChatMessage(
  input: Omit<EcosystemChatMessage, 'id' | 'at'> & { id?: string; at?: number },
  home: string = homedir()
): Promise<EcosystemChatMessage> {
  await ensureEcosystemDirs(home)
  const existing = await readEcosystemChatMessages(home, 120)
  const entry: EcosystemChatMessage = {
    id: input.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: input.role,
    source: input.source,
    sender: input.sender,
    text: input.text.trim().slice(0, 12_000),
    at: input.at ?? Date.now(),
    routedAgent: input.routedAgent,
    rikuganUsed: input.rikuganUsed
  }
  if (entry.role === 'assistant') {
    const digest = `${entry.source}:${entry.text.slice(0, 160)}`
    if (digest === lastRecordedAssistantDigest) {
      return entry
    }
    lastRecordedAssistantDigest = digest
  }
  const next = [...existing, entry].slice(-100)
  const target = chatHistoryPath(home)
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 6)}`
  await writeFile(tmp, `${JSON.stringify({ messages: next }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(tmp, target)
  return entry
}

export async function clearEcosystemChatMessages(home: string = homedir()): Promise<void> {
  await ensureEcosystemDirs(home)
  lastRecordedAssistantDigest = ''
  await writeFile(chatHistoryPath(home), `${JSON.stringify({ messages: [] }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}
