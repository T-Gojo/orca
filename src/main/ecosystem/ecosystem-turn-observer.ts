import { homedir } from 'node:os'
import type { AgentJournalRenderItem } from '../../shared/agent-session/journal/agent-session-journal-types'
import { appendEcosystemChatMessage, isTrackedEcosystemBotSession } from './ecosystem-chat-store'
import { readEcosystemConfig, readEcosystemSecrets } from './ecosystem-config'
import { saveValidatedSkillWithUndo } from './hermes-learning-connector'
import {
  isExplicitRikuganRequest,
  prefetchRikuganContext,
  recordCompletedSessionToRikugan
} from './rikugan-connector'

/** Fork: post-turn observer & Hermes skill synthesizer — Rikugan stays strictly opt-in (§16). */

function extractMessageText(item: AgentJournalRenderItem): string {
  if (item.body.kind !== 'message') {
    return ''
  }
  return item.body.blocks
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function queryFallbackBridgeLlm(
  composedPrompt: string,
  home: string = homedir()
): Promise<{ reply: string | null; error: string | null }> {
  const secrets = await readEcosystemSecrets(home)
  if (!secrets.OAIBO_API_KEY) {
    return {
      reply: null,
      error: 'Enable Bots in Orca Settings › Bots to dispatch native sessions.'
    }
  }
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
        messages: [
          {
            role: 'system',
            content:
              'You are Orca HQ — the unified orchestrator fusing Orca, OpenClaw (WhatsApp/Telegram), and Hermes Agent. Be concise, direct, and helpful.'
          },
          { role: 'user', content: composedPrompt }
        ]
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
    return { reply: content, error: content ? null : 'Bridge returned no reply' }
  } catch (err) {
    return { reply: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function synthesizeSkillMarkdownForTopic(
  topic: string,
  home: string = homedir()
): Promise<string> {
  const cleanTopic = topic.trim() || 'recent-workflow'
  const slug =
    cleanTopic
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'learned-workflow'
  const ctx = isExplicitRikuganRequest(cleanTopic)
    ? await prefetchRikuganContext(cleanTopic, `learn:${slug}`, { home })
    : { text: '', itemCount: 0 }
  const secrets = await readEcosystemSecrets(home)
  if (secrets.OAIBO_API_KEY) {
    const synthRes = await fetch('https://oaibo.jumpbump.in/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.OAIBO_API_KEY}`,
        'Content-Type': 'application/json',
        'X-App-Name': 'orca-hermes-learn'
      },
      body: JSON.stringify({
        model: 'agy_gemini-3.8-flash-medium',
        messages: [
          {
            role: 'system',
            content:
              'Output ONLY raw SKILL.md text starting with --- YAML frontmatter (`name:` kebab-case, `description:` STRICTLY <=58 chars) followed by --- and concise actionable instructions. No code fences around the file.'
          },
          {
            role: 'user',
            content: `Distill a reusable agent skill for: ${cleanTopic}\n\nContext:\n${ctx.text || 'Local macOS + Orca workflow'}`
          }
        ]
      })
    }).catch(() => null)
    const synthJson: unknown = synthRes?.ok ? await synthRes.json().catch(() => null) : null
    if (
      typeof synthJson === 'object' &&
      synthJson !== null &&
      'choices' in synthJson &&
      Array.isArray(synthJson.choices) &&
      typeof synthJson.choices[0]?.message?.content === 'string'
    ) {
      const md = synthJson.choices[0].message.content
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```$/i, '')
        .trim()
      if (md) {
        return md
      }
    }
  }
  const shortDesc = `Reusable workflow for ${cleanTopic}`.slice(0, 58)
  return `---\nname: ${slug}\ndescription: "${shortDesc}"\n---\n\n# ${cleanTopic}\n\n${ctx.text || `Follow verified steps for ${cleanTopic} in Orca.`}\n`
}

export function observeEcosystemTurnEnded(
  sessionId: string,
  readItems: (since: number) => Promise<readonly AgentJournalRenderItem[]>
): void {
  void (async () => {
    const isEcoSession = isTrackedEcosystemBotSession(sessionId)
    const cfg = await readEcosystemConfig().catch(() => null)
    if (!isEcoSession && !cfg?.rikuganAutoRecord && !cfg?.autoLearnEnabled) {
      return
    }
    const items = await readItems(0).catch(() => [])
    const userTexts: string[] = []
    const assistantTexts: string[] = []
    for (const item of items) {
      if (item.body.kind !== 'message') {
        continue
      }
      const txt = extractMessageText(item)
      if (!txt) {
        continue
      }
      if (item.body.role === 'user') {
        userTexts.push(txt)
      } else if (item.body.role === 'assistant') {
        assistantTexts.push(txt)
      }
    }
    const lastAssistant = assistantTexts.at(-1) ?? ''
    const firstUser = userTexts[0] ?? ''
    if (isEcoSession && lastAssistant) {
      await appendEcosystemChatMessage({
        role: 'assistant',
        source: 'orca-hq',
        sender: 'Orca HQ',
        text: lastAssistant,
        routedAgent: 'orca-hq',
        rikuganUsed: false
      }).catch(() => null)
    }
    // Strictly opt-in: never send completed Orca/CLI sessions to Rikugan unless rikuganAutoRecord is explicitly enabled.
    if (cfg?.rikuganAutoRecord === true && userTexts.length >= 2 && lastAssistant.length >= 80) {
      await recordCompletedSessionToRikugan({
        sessionId,
        title: firstUser.slice(0, 80),
        summary: `${firstUser.slice(0, 220)} -> ${lastAssistant.slice(0, 600)}`,
        outcome: 'done'
      }).catch(() => false)
    }
    if (cfg?.autoLearnEnabled && lastAssistant.includes('```skill-md\n')) {
      const block = lastAssistant.match(/```skill-md\n([\s\S]*?)```/)?.[1]
      if (block) {
        await saveValidatedSkillWithUndo({ markdown: block, sourceSessionId: sessionId }).catch(
          () => null
        )
      }
    }
  })()
}
