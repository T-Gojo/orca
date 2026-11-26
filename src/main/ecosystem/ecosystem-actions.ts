import { homedir } from 'node:os'
import { latestStructuredAgentSessionAssistantMessage } from '../../shared/agent-session/requests/structured-agent-session-latest-request'
import type {
  EcosystemAskResult,
  EcosystemLearnResult
} from '../../shared/ecosystem/ecosystem-types'
import { requireStructuredHost, runtimeBotChats } from '../bots/bot-chat-session'
import { readTurnEndedItems } from '../native-chat/agent-session-wire/structured-agent-session-turn-context'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { appendEcosystemChatMessage, trackEcosystemBotSession } from './ecosystem-chat-store'
import { readEcosystemConfig } from './ecosystem-config'
import { ensurePrimaryEcosystemBot } from './ecosystem-service'
import {
  observeEcosystemTurnEnded,
  queryFallbackBridgeLlm,
  synthesizeSkillMarkdownForTopic
} from './ecosystem-turn-observer'
import { buildHermesReviewBrief, saveValidatedSkillWithUndo } from './hermes-learning-connector'
import { installFromSkillsHub, searchSkillsHub } from './hermes-skills-hub'
import { isExplicitRikuganRequest, prefetchRikuganContext } from './rikugan-connector'

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
    rikugan?: boolean
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
  const source = input.source ?? 'desktop'
  const sender = input.senderName ?? 'Owner'
  const cfg = await readEcosystemConfig(home)
  const shouldUseRikugan =
    isExplicitRikuganRequest(cleanPrompt, input.rikugan) || cfg.rikuganAutoContext
  const sessionKey = input.externalId ?? 'orca-hq-primary'
  const context = shouldUseRikugan
    ? await prefetchRikuganContext(cleanPrompt, sessionKey, { home })
    : { text: '', itemCount: 0 }

  await appendEcosystemChatMessage(
    {
      role: 'user',
      source,
      sender,
      text: cleanPrompt,
      routedAgent: null,
      rikuganUsed: context.itemCount > 0
    },
    home
  ).catch(() => null)

  const sourceHeader = input.source
    ? `[Unified Ingress: ${input.source}${input.senderName ? ` · ${input.senderName}` : ''}]\n`
    : ''
  const memoryBlock = context.text ? `<memory-context>\n${context.text}\n</memory-context>\n\n` : ''
  const composedPrompt = `${sourceHeader}${memoryBlock}${cleanPrompt}`

  const bot = await ensurePrimaryEcosystemBot(runtime)
  if (bot) {
    try {
      const chats = runtimeBotChats(runtime)
      const targetSessionId = await chats.ensure(bot.id)
      trackEcosystemBotSession(targetSessionId)
      const waitPromise =
        input.wait === true ? waitForStructuredTurnReply(runtime, targetSessionId, 45_000) : null
      const delivered = await chats.sendToChat(bot.id, composedPrompt)
      trackEcosystemBotSession(delivered.sessionId)
      const reply = waitPromise ? await waitPromise : null
      if (reply) {
        await appendEcosystemChatMessage(
          {
            role: 'assistant',
            source,
            sender: bot.name,
            text: reply,
            routedAgent: bot.agent,
            rikuganUsed: context.itemCount > 0
          },
          home
        ).catch(() => null)
      }
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
    } catch {
      // Fall through to OAIBO bridge if local bot session failed to boot
    }
  }

  const fb = await queryFallbackBridgeLlm(composedPrompt, home)
  if (fb.reply) {
    await appendEcosystemChatMessage(
      {
        role: 'assistant',
        source,
        sender: 'Orca HQ',
        text: fb.reply,
        routedAgent: 'orca-hq-llm',
        rikuganUsed: context.itemCount > 0
      },
      home
    ).catch(() => null)
  }
  return {
    accepted: Boolean(fb.reply),
    sessionId: null,
    botId: null,
    routedAgent: fb.reply ? 'orca-hq-llm' : null,
    routedAccount: null,
    rikuganItemsAttached: context.itemCount,
    reply: fb.reply,
    error: fb.error
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
      { prompt: brief.prompt, source: 'hermes-review', wait: true },
      home
    )
    return {
      ok: asked.accepted,
      mode: 'review',
      skillName: null,
      backupId: null,
      dispatchId: asked.sessionId,
      summary:
        asked.reply ??
        (asked.accepted
          ? `Dispatched independent Hermes review to session ${asked.sessionId ?? 'orca-hq'}.`
          : (asked.error ?? 'Review dispatch failed.'))
    }
  }

  const topicText = (input.topic ?? '').trim() || 'recent-workflow'
  await appendEcosystemChatMessage(
    {
      role: 'user',
      source: 'hermes-learn',
      sender: 'Owner',
      text: `Distill Hermes skill: ${topicText}`,
      routedAgent: null,
      rikuganUsed: false
    },
    home
  ).catch(() => null)
  const md = input.markdown?.trim() || (await synthesizeSkillMarkdownForTopic(topicText, home))
  const saved = await saveValidatedSkillWithUndo({ markdown: md }, home)
  const summary = saved.ok
    ? `Distilled & synced skill '${saved.entry?.skillName}' (${saved.entry?.action}) across all 6 CLIs.`
    : (saved.error ?? 'Skill distillation failed.')
  await appendEcosystemChatMessage(
    {
      role: 'assistant',
      source: 'hermes-learn',
      sender: 'Hermes Distiller',
      text: summary,
      routedAgent: 'hermes-distiller',
      rikuganUsed: false
    },
    home
  ).catch(() => null)
  return {
    ok: saved.ok,
    mode: 'learn',
    skillName: saved.entry?.skillName ?? null,
    backupId: saved.entry?.backupId ?? null,
    dispatchId: null,
    summary
  }
}
