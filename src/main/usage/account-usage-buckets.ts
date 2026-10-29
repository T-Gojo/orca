import type { AccountUsageBucket, UsageSourceRollup } from '../../shared/account-usage-ledger-types'
import type { ClaudeUsageDailyAggregate } from '../claude-usage/types'
import type { CodexUsageDailyAggregate } from '../codex-usage/types'
import type { OpenCodeUsageDailyAggregate } from '../opencode-usage/types'
import { estimateCostUsd as estimateClaudeCostUsd } from '../claude-usage/claude-model-pricing'
import { estimateCostUsd as estimateCodexCostUsd } from '../codex-usage/codex-usage-cost-estimate'

export function claudeAggregateBucket(row: ClaudeUsageDailyAggregate): AccountUsageBucket {
  const cacheTokens = row.cacheReadTokens + row.cacheWriteTokens
  return {
    day: row.day,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens,
    reasoningTokens: 0,
    totalTokens: row.inputTokens + row.outputTokens + cacheTokens,
    activity: row.turnCount,
    credits: 0,
    costUsd: estimateClaudeCostUsd(row.model, row)
  }
}

export function codexAggregateBucket(row: CodexUsageDailyAggregate): AccountUsageBucket {
  return {
    day: row.day,
    model: row.model,
    inputTokens: Math.max(row.inputTokens - row.cachedInputTokens, 0),
    outputTokens: row.outputTokens,
    cacheTokens: row.cachedInputTokens,
    reasoningTokens: row.reasoningOutputTokens,
    totalTokens: row.totalTokens,
    activity: row.eventCount,
    credits: 0,
    costUsd: estimateCodexCostUsd(row.model, row)
  }
}

export function openCodeAggregateBucket(row: OpenCodeUsageDailyAggregate): AccountUsageBucket {
  const cacheTokens = row.cachedInputTokens + (row.cacheWriteInputTokens ?? 0)
  return {
    day: row.day,
    model: row.model,
    inputTokens: Math.max(row.inputTokens - row.cachedInputTokens, 0),
    outputTokens: row.outputTokens,
    cacheTokens,
    reasoningTokens: row.reasoningOutputTokens,
    totalTokens: row.totalTokens,
    activity: row.eventCount,
    credits: 0,
    costUsd: row.estimatedCostUsd
  }
}

/** Average tokens per agent step across these logs, or null with too little to measure. */
export function tokensPerStep(
  rollups: readonly UsageSourceRollup[],
  steps: number
): {
  tokens: number
  split: Pick<
    AccountUsageBucket,
    'inputTokens' | 'outputTokens' | 'cacheTokens' | 'reasoningTokens'
  >
} | null {
  const total = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, reasoningTokens: 0 }
  for (const rollup of rollups) {
    for (const bucket of rollup.buckets) {
      total.inputTokens += bucket.inputTokens
      total.outputTokens += bucket.outputTokens
      total.cacheTokens += bucket.cacheTokens
      total.reasoningTokens += bucket.reasoningTokens
    }
  }
  const tokens = total.inputTokens + total.outputTokens + total.cacheTokens
  // Why a floor: a rate from a handful of steps would swing the whole IDE estimate.
  if (steps < 100 || tokens <= 0) {
    return null
  }
  return {
    tokens: tokens / steps,
    split: {
      inputTokens: total.inputTokens / steps,
      outputTokens: total.outputTokens / steps,
      cacheTokens: total.cacheTokens / steps,
      reasoningTokens: total.reasoningTokens / steps
    }
  }
}
