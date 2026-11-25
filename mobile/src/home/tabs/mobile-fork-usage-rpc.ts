import * as z from 'zod'
import { defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'

// Fork: RPC operations and formatting helpers for mobile usage windows & multi-CLI quotas (FORK.md §15).

export const MOBILE_USAGE_WINDOWS = ['1h', '5h', '7d', 'all'] as const
export type MobileUsageWindow = (typeof MOBILE_USAGE_WINDOWS)[number]

const ModelBreakdownSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  activity: z.number(),
  credits: z.number(),
  estimatedCostUsd: z.number().nullable(),
  estimated: z.boolean()
})

const WindowRowSchema = z.object({
  provider: z.string(),
  accountKey: z.string(),
  label: z.string().nullable(),
  removed: z.boolean(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  activity: z.number(),
  credits: z.number(),
  sessions: z.number(),
  estimatedCostUsd: z.number().nullable(),
  lastActiveAt: z.string().nullable(),
  models: z.array(ModelBreakdownSchema),
  estimated: z.boolean()
})

const WindowSummarySchema = z.object({
  window: z.enum(MOBILE_USAGE_WINDOWS),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
  estimatedCostUsd: z.number().nullable(),
  activity: z.number(),
  estimated: z.boolean()
})

const UsageWindowsSnapshotSchema = z.object({
  window: z.string(),
  updatedAt: z.number().nullable(),
  summaries: z.array(WindowSummarySchema),
  rows: z.array(WindowRowSchema)
})

export type MobileUsageWindowsSnapshot = z.infer<typeof UsageWindowsSnapshotSchema>
export type MobileUsageWindowRow = z.infer<typeof WindowRowSchema>

const DelegationUsageWindowSchema = z.object({
  name: z.enum(['session', 'weekly', 'monthly']),
  usedPercent: z.number(),
  resetsAt: z.number().nullable()
})

const DelegationAccountUsageSchema = z.object({
  agent: z.string(),
  accountId: z.string().nullable(),
  label: z.string().nullable(),
  active: z.boolean(),
  usedPercent: z.number().nullable(),
  windows: z.array(DelegationUsageWindowSchema),
  readAt: z.number().nullable(),
  error: z.string().nullable(),
  available: z.boolean()
})

const DelegationUsageResponseSchema = z.object({
  usage: z.array(DelegationAccountUsageSchema),
  readAt: z.number()
})

export type MobileDelegationAccountUsage = z.infer<typeof DelegationAccountUsageSchema>

export const delegationUsageWindowsOp = defineRpcOperation({
  name: 'fork.mobile-delegation-usage-windows',
  method: 'delegation.usageWindows',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('delegation-usage-windows', UsageWindowsSnapshotSchema)
})

export const delegationUsageOp = defineRpcOperation({
  name: 'fork.mobile-delegation-usage',
  method: 'delegation.usage',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('delegation-usage', DelegationUsageResponseSchema)
})

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  mistral: 'Mistral Vibe',
  'mistral-vibe': 'Mistral Vibe',
  opencode: 'OpenCode'
}

export function formatForkProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export function providerToAgentIconId(provider: string): string {
  if (provider === 'mistral') {
    return 'mistral-vibe'
  }
  return provider
}

export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0'
  }
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return String(Math.round(tokens))
}

export function formatResetCountdown(resetsAt: number | null, nowMs: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) {
    return null
  }
  const diffMs = resetsAt - nowMs
  if (diffMs <= 60_000) {
    return null
  }
  const totalMinutes = Math.round(diffMs / 60_000)
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }
  const totalHours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (totalHours < 24) {
    return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`
  }
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`
}
