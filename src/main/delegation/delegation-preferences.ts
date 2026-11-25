import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import {
  DELEGATION_AGENTS,
  DELEGATION_TIERS,
  type DelegationPreferences
} from '../../shared/delegation/delegation-types'

const Agent = z.enum(DELEGATION_AGENTS)
const Models = z.partialRecord(Agent, z.string().min(1).max(200))

const PreferencesSchema = z.object({
  agentOrder: z.array(Agent).min(1).default(['antigravity', 'kiro', 'codex', 'claude']),
  models: Models.default({}),
  maxUsedPercent: z.number().min(1).max(100).default(90),
  kinds: z
    .record(
      z.string().min(1).max(64),
      z.object({ agents: z.array(Agent).min(1).optional(), models: Models.optional() })
    )
    .default({}),
  profiles: z
    .partialRecord(
      Agent,
      z.object({ tier: z.enum(DELEGATION_TIERS), note: z.string().max(300).optional() })
    )
    .default({}),
  autoDelegation: z
    .object({
      enabled: z.boolean().default(true),
      ownUsedPercent: z.number().min(1).max(100).default(70)
    })
    .default({ enabled: true, ownUsedPercent: 70 })
})

// Tiers fill in per agent so a preferences file written before them still gets them.
const DEFAULT_PROFILES: DelegationPreferences['profiles'] = {
  antigravity: { tier: 'light', note: 'Gemini Flash' },
  kiro: { tier: 'standard', note: 'Kiro' },
  codex: { tier: 'strong', note: 'OpenAI Codex' },
  claude: { tier: 'strong', note: 'Claude Code, another account' }
}

export const DEFAULT_DELEGATION_PREFERENCES: DelegationPreferences = PreferencesSchema.parse({
  profiles: DEFAULT_PROFILES,
  kinds: {
    review: { agents: ['codex', 'antigravity', 'kiro'] },
    research: { agents: ['antigravity', 'kiro', 'codex'] }
  }
})

export function delegationPreferencesPath(): string {
  return join(getAppEnvironment().getPath('userData'), 'orca-delegation.json')
}

/** Reads the user's delegation preferences, writing the defaults on first use so they are editable. */
export async function readDelegationPreferences(
  path = delegationPreferencesPath()
): Promise<DelegationPreferences> {
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (text === null) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(DEFAULT_DELEGATION_PREFERENCES, null, 2)}\n`)
    return DEFAULT_DELEGATION_PREFERENCES
  }
  const parsed = PreferencesSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new Error(
      `${path} is not valid delegation preferences: ${parsed.error.issues[0]?.message ?? 'invalid'}`
    )
  }
  return { ...parsed.data, profiles: { ...DEFAULT_PROFILES, ...parsed.data.profiles } }
}
