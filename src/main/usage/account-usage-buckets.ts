import type { AccountUsageBucket } from '../../shared/account-usage-ledger-types'
import type { ClaudeUsageDailyAggregate } from '../claude-usage/types'
import type { CodexUsageDailyAggregate } from '../codex-usage/types'
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
    costUsd: estimateCodexCostUsd(row.model, row)
  }
}
