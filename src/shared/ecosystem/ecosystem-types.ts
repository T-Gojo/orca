import { z } from 'zod'

/** Fork: shared contracts for the unified Orca + Rikugan + OpenClaw + Hermes ecosystem (§16). */

export const ECOSYSTEM_CHANNEL_IDS = ['telegram', 'whatsapp', 'http'] as const
export type EcosystemChannelId = (typeof ECOSYSTEM_CHANNEL_IDS)[number]

export const ECOSYSTEM_CONNECTOR_STATES = [
  'online',
  'degraded',
  'unconfigured',
  'pairing',
  'offline'
] as const
export type EcosystemConnectorState = (typeof ECOSYSTEM_CONNECTOR_STATES)[number]

export const EcosystemPairingRequestSchema = z.object({
  code: z.string(),
  channel: z.enum(['telegram', 'whatsapp']),
  senderId: z.string(),
  senderName: z.string().nullable(),
  createdAt: z.number(),
  expiresAt: z.number()
})
export type EcosystemPairingRequest = z.infer<typeof EcosystemPairingRequestSchema>

export const EcosystemChannelStatusSchema = z.object({
  id: z.enum(ECOSYSTEM_CHANNEL_IDS),
  label: z.string(),
  enabled: z.boolean(),
  state: z.enum(ECOSYSTEM_CONNECTOR_STATES),
  detail: z.string(),
  allowlistCount: z.number().int().nonnegative(),
  activeThreads: z.number().int().nonnegative(),
  lastInboundAt: z.number().nullable(),
  lastOutboundAt: z.number().nullable(),
  qrDataUrl: z.string().nullable().optional(),
  qrAscii: z.string().nullable().optional(),
  selfJid: z.string().nullable().optional(),
  botUsername: z.string().nullable().optional()
})
export type EcosystemChannelStatus = z.infer<typeof EcosystemChannelStatusSchema>

export const EcosystemRikuganStatusSchema = z.object({
  state: z.enum(ECOSYSTEM_CONNECTOR_STATES),
  url: z.string(),
  version: z.string().nullable(),
  hasToken: z.boolean(),
  totalNodes: z.number().int().nonnegative().nullable(),
  embeddedChunks: z.number().int().nonnegative().nullable(),
  semanticReady: z.boolean(),
  recordedSessions: z.number().int().nonnegative(),
  lastContextMs: z.number().nullable(),
  detail: z.string()
})
export type EcosystemRikuganStatus = z.infer<typeof EcosystemRikuganStatusSchema>

export const EcosystemSkillBackupEntrySchema = z.object({
  backupId: z.string(),
  skillName: z.string(),
  action: z.enum(['created', 'patched']),
  description: z.string(),
  createdAt: z.number(),
  scannerClean: z.boolean(),
  sourceSessionId: z.string().nullable()
})
export type EcosystemSkillBackupEntry = z.infer<typeof EcosystemSkillBackupEntrySchema>

export const EcosystemHermesStatusSchema = z.object({
  state: z.enum(ECOSYSTEM_CONNECTOR_STATES),
  autoLearnEnabled: z.boolean(),
  ptcReady: z.boolean(),
  reviewReady: z.boolean(),
  skillsHubReady: z.boolean(),
  hermesAcpInstalled: z.boolean(),
  legacyGatewayParked: z.boolean(),
  installedSkillsCount: z.number().int().nonnegative(),
  learnedSkillsCount: z.number().int().nonnegative(),
  learningGraphEdges: z.number().int().nonnegative(),
  topSkillsUsed: z.array(z.object({ name: z.string(), uses: z.number().int().nonnegative() })),
  recentLearnedSkills: z.array(EcosystemSkillBackupEntrySchema),
  detail: z.string()
})
export type EcosystemHermesStatus = z.infer<typeof EcosystemHermesStatusSchema>

export const EcosystemStatusSnapshotSchema = z.object({
  checkedAt: z.number(),
  macStandaloneReady: z.boolean(),
  runtimeDir: z.string(),
  bridgePort: z.number().int(),
  bridgeRunning: z.boolean(),
  bridgePid: z.number().int().nullable(),
  primaryBotId: z.string().nullable(),
  primaryBotName: z.string().nullable(),
  rikugan: EcosystemRikuganStatusSchema,
  hermes: EcosystemHermesStatusSchema,
  channels: z.array(EcosystemChannelStatusSchema),
  pendingPairings: z.array(EcosystemPairingRequestSchema),
  recentDeliveries: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      sender: z.string(),
      preview: z.string(),
      at: z.number(),
      status: z.string()
    })
  )
})
export type EcosystemStatusSnapshot = z.infer<typeof EcosystemStatusSnapshotSchema>

export const ECOSYSTEM_CONTROL_ACTIONS = [
  'up',
  'down',
  'sync',
  'approve-pairing',
  'set-telegram-token',
  'whatsapp-login',
  'whatsapp-logout',
  'toggle-auto-learn',
  'undo-skill',
  'notify',
  'park-hermes-gateway'
] as const
export type EcosystemControlAction = (typeof ECOSYSTEM_CONTROL_ACTIONS)[number]

export const EcosystemAskResultSchema = z.object({
  accepted: z.boolean(),
  sessionId: z.string().nullable(),
  botId: z.string().nullable(),
  routedAgent: z.string().nullable(),
  routedAccount: z.string().nullable(),
  rikuganItemsAttached: z.number().int().nonnegative(),
  reply: z.string().nullable(),
  error: z.string().nullable()
})
export type EcosystemAskResult = z.infer<typeof EcosystemAskResultSchema>

export const EcosystemLearnResultSchema = z.object({
  ok: z.boolean(),
  mode: z.enum(['learn', 'review', 'skills-search', 'skills-install']),
  skillName: z.string().nullable(),
  backupId: z.string().nullable(),
  dispatchId: z.string().nullable(),
  summary: z.string(),
  items: z
    .array(
      z.object({
        name: z.string(),
        source: z.string(),
        description: z.string(),
        url: z.string().nullable()
      })
    )
    .optional()
})
export type EcosystemLearnResult = z.infer<typeof EcosystemLearnResultSchema>
