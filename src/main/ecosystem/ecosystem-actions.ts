import { homedir } from 'node:os'
import { latestStructuredAgentSessionAssistantMessage } from '../../shared/agent-session/requests/structured-agent-session-latest-request'
import type {
  EcosystemAskResult,
  EcosystemLearnResult
} from '../../shared/ecosystem/ecosystem-types'
import { requireStructuredHost, runtimeBotChats } from '../bots/bot-chat-session'
import { readTurnEndedItems } from '../native-chat/agent-session-wire/structured-agent-session-turn-context'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { readEcosystemSecrets } from './ecosystem-config'
import { ensurePrimaryEcosystemBot } from './ecosystem-service'
import {
  observeEcosystemTurnEnded,
  synthesizeSkillMarkdownForTopic
} from './ecosystem-turn-observer'
import { buildHermesReviewBrief, saveValidatedSkillWithUndo } from './hermes-learning-connector'
import { installFromSkillsHub, searchSkillsHub } from './hermes-skills-hub'
import { prefetchRikuganContext } from './rikugan-connector'

export { observeEcosystemTurnEnded }

/** Fork: unified Ask & Hermes (`/review`, `/learn`, Skills Hub) actions (§16). */

async function waitForStructuredTurnReply(
  runtime: OrcaRuntimeService,
  sessionId: string,
  timeoutMs: number
): Promise<string | null> {
  const host = await requireStructuredHost(runtime)
  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = host.subscribeTurnCompletions({
      id: `ecosystem-ask-wait-${sessionId}-${Date.now()}`,
      emit: (event) => {
        if (event.type !== 'completion' || event.completion.sessionId !== sessionId) {
          return
        }
        const { turnId } = event.completion
        void host
          .journalReads(sessionId)
          .then((reads) => readTurnEndedItems(reads, turnId, 0))
          .then((rows) => finish(latestStructuredAgentSessionAssistantMessage(rows.items) ?? null))
          .catch(() => finish(null))
      }
    })
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}

export async function askEcosystem(
  runtime: OrcaRuntimeService,
  input: {
    prompt: string
    source?: string
    externalId?: string
    senderName?: string
    agent?: string
    wait?: boolean
  },
  home: string = homedir()
): Promise<EcosystemAskResult> {
  const cleanPrompt = input.prompt.trim()
  if (!cleanPrompt) {
    return {
      accepted: false,
      sessionId: null,
      botId: null,
      routedAgent: null,
      routedAccount: null,
      rikuganItemsAttached: 0,
      reply: null,
      error: 'Empty prompt'
    }
  }
  const sessionKey = input.externalId ?? 'orca-hq-primary'
  const context = await prefetchRikuganContext(cleanPrompt, sessionKey, { home })
  const sourceHeader = input.source
    ? `[Unified Ingress: ${input.source}${input.senderName ? ` · ${input.senderName}` : ''}]\n`
    : ''
  const memoryBlock = context.text ? `<memory-context>\n${context.text}\n</memory-context>\n\n` : ''
  const composedPrompt = `${sourceHeader}${memoryBlock}${cleanPrompt}`

  const bot = await ensurePrimaryEcosystemBot(runtime)
  if (bot) {
    const chats = runtimeBotChats(runtime)
    const targetSessionId = await chats.ensure(bot.id)
    const waitPromise =
      input.wait === true ? waitForStructuredTurnReply(runtime, targetSessionId, 150_000) : null
    const delivered = await chats.sendToChat(bot.id, composedPrompt)
    const reply = waitPromise ? await waitPromise : null
    return {
      accepted: true,
      sessionId: delivered.sessionId,
      botId: bot.id,
      routedAgent: bot.agent,
      routedAccount: null,
      rikuganItemsAttached: context.itemCount,
      reply,
      error: null
    }
  }

  const secrets = await readEcosystemSecrets(home)
  if (secrets.OAIBO_API_KEY) {
    try {
      const res = await fetch('https://oaibo.jumpbump.in/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.OAIBO_API_KEY}`,
          'Content-Type': 'application/json',
          'X-App-Name': 'orca-ecosystem-core'
        },
        body: JSON.stringify({
          model: 'agy_gemini-3.8-flash-medium',
          messages: [{ role: 'user', content: composedPrompt }]
        })
      })
      const json: unknown = await res.json()
      const content =
        typeof json === 'object' &&
        json !== null &&
        'choices' in json &&
        Array.isArray(json.choices) &&
        typeof json.choices[0]?.message?.content === 'string'
          ? json.choices[0].message.content
          : null
      return {
        accepted: Boolean(content),
        sessionId: null,
        botId: null,
        routedAgent: 'oaibo-bridge',
        routedAccount: null,
        rikuganItemsAttached: context.itemCount,
        reply: content,
        error: content ? null : 'Bridge returned no reply'
      }
    } catch (err) {
      return {
        accepted: false,
        sessionId: null,
        botId: null,
        routedAgent: null,
        routedAccount: null,
        rikuganItemsAttached: context.itemCount,
        reply: null,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
  return {
    accepted: false,
    sessionId: null,
    botId: null,
    routedAgent: null,
    routedAccount: null,
    rikuganItemsAttached: context.itemCount,
    reply: null,
    error: 'Enable Bots in Orca Settings › Bots to dispatch native sessions.'
  }
}

export async function runEcosystemHermesAction(
  runtime: OrcaRuntimeService,
  input: {
    mode: 'learn' | 'review' | 'skills-search' | 'skills-install'
    topic?: string
    markdown?: string
    focus?: string
    query?: string
  },
  home: string = homedir()
): Promise<EcosystemLearnResult> {
  if (input.mode === 'skills-search') {
    const items = await searchSkillsHub(input.query ?? input.topic ?? '', home)
    return {
      ok: true,
      mode: 'skills-search',
      skillName: null,
      backupId: null,
      dispatchId: null,
      summary: `Found ${items.length} matching skill(s).`,
      items: items.map(({ name, source, description, url }) => ({ name, source, description, url }))
    }
  }
  if (input.mode === 'skills-install') {
    const installed = await installFromSkillsHub(input.query ?? input.topic ?? '', home)
    return {
      ok: installed.ok,
      mode: 'skills-install',
      skillName: installed.skillName,
      backupId: installed.backupId,
      dispatchId: null,
      summary: installed.summary
    }
  }
  if (input.mode === 'review') {
    const brief = buildHermesReviewBrief({
      messages: [
        { role: 'user', text: input.focus ?? input.topic ?? 'Review current workspace changes' }
      ],
      ...(input.focus ? { focus: input.focus } : {})
    })
    const asked = await askEcosystem(
      runtime,
      { prompt: brief.prompt, source: 'hermes-review', wait: false },
      home
    )
    return {
      ok: asked.accepted,
      mode: 'review',
      skillName: null,
      backupId: null,
      dispatchId: asked.sessionId,
      summary: asked.accepted
        ? `Dispatched independent Hermes review to session ${asked.sessionId ?? 'orca-hq'}.`
        : (asked.error ?? 'Review dispatch failed.')
    }
  }

  const md =
    input.markdown?.trim() || (await synthesizeSkillMarkdownForTopic(input.topic ?? '', home))
  const saved = await saveValidatedSkillWithUndo({ markdown: md }, home)
  return {
    ok: saved.ok,
    mode: 'learn',
    skillName: saved.entry?.skillName ?? null,
    backupId: saved.entry?.backupId ?? null,
    dispatchId: null,
    summary: saved.ok
      ? `Distilled & synced skill '${saved.entry?.skillName}' (${saved.entry?.action}) across all 6 CLIs.`
      : (saved.error ?? 'Skill distillation failed.')
  }
}
