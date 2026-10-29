import type { CodexUsageSummary } from '../../../../shared/codex-usage-types'
import type { OpenCodeUsageSummary } from '../../../../shared/opencode-usage-types'
import type { MuseUsageSummary } from '../../../../shared/muse-usage-types'
import { countActiveDays, getClaudeDailyTotal } from './usage-overview-daily-series'
import {
  LEDGER_ONLY_PROVIDERS,
  type UsageOverviewInput,
  type UsageProviderOverview
} from './usage-overview-types'
import { translate } from '@/i18n/i18n'

function getCodexNewInputTokens(summary: CodexUsageSummary | null): number {
  if (!summary) {
    return 0
  }
  return Math.max(summary.inputTokens - summary.cachedInputTokens, 0)
}

function getMuseNewInputTokens(summary: MuseUsageSummary | null): number {
  if (!summary) {
    return 0
  }
  return Math.max(summary.inputTokens - summary.cachedInputTokens, 0)
}

function getOpenCodeNewInputTokens(summary: OpenCodeUsageSummary | null): number {
  if (!summary) {
    return 0
  }
  return Math.max(summary.inputTokens - summary.cachedInputTokens, 0)
}

export function createClaudeProvider(input: UsageOverviewInput['claude']): UsageProviderOverview {
  const summary = input.summary
  const dailyActiveDays = input.daily
    .filter((entry) => getClaudeDailyTotal(entry) > 0)
    .map((entry) => entry.day)
  return {
    id: 'claude',
    label: translate('auto.components.stats.usage.overview.model.544d6d4c16', 'Claude'),
    enabled: input.scanState?.enabled ?? false,
    isScanning: input.scanState?.isScanning ?? false,
    hasData: summary?.hasAnyClaudeData ?? input.scanState?.hasAnyClaudeData ?? false,
    lastScanCompletedAt: input.scanState?.lastScanCompletedAt ?? null,
    lastScanError: input.scanState?.lastScanError ?? null,
    sessions: summary?.sessions ?? 0,
    activityLabel: 'turns',
    activityCount: summary?.turns ?? 0,
    totalTokens: summary
      ? summary.inputTokens +
        summary.outputTokens +
        summary.cacheReadTokens +
        summary.cacheWriteTokens
      : 0,
    newInputTokens: summary?.inputTokens ?? 0,
    outputTokens: summary?.outputTokens ?? 0,
    cacheTokens: summary ? summary.cacheReadTokens + summary.cacheWriteTokens : 0,
    reasoningTokens: 0,
    estimatedCostUsd: summary?.estimatedCostUsd ?? null,
    hasPartialCost: summary?.hasUnpricedModels ?? false,
    topModel: summary?.topModel ?? null,
    topProject: summary?.topProject ?? null,
    activeDays: countActiveDays(dailyActiveDays)
  }
}

export function createCodexProvider(input: UsageOverviewInput['codex']): UsageProviderOverview {
  const summary = input.summary
  const dailyActiveDays = input.daily
    .filter((entry) => entry.totalTokens > 0)
    .map((entry) => entry.day)
  return {
    id: 'codex',
    label: translate('auto.components.stats.usage.overview.model.eb220d193b', 'Codex'),
    enabled: input.scanState?.enabled ?? false,
    isScanning: input.scanState?.isScanning ?? false,
    hasData: summary?.hasAnyCodexData ?? input.scanState?.hasAnyCodexData ?? false,
    lastScanCompletedAt: input.scanState?.lastScanCompletedAt ?? null,
    lastScanError: input.scanState?.lastScanError ?? null,
    sessions: summary?.sessions ?? 0,
    activityLabel: 'events',
    activityCount: summary?.events ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
    newInputTokens: getCodexNewInputTokens(summary),
    outputTokens: summary?.outputTokens ?? 0,
    cacheTokens: summary?.cachedInputTokens ?? 0,
    reasoningTokens: summary?.reasoningOutputTokens ?? 0,
    estimatedCostUsd: summary?.estimatedCostUsd ?? null,
    hasPartialCost: summary?.hasUnpricedModels ?? false,
    topModel: summary?.topModel ?? null,
    topProject: summary?.topProject ?? null,
    activeDays: countActiveDays(dailyActiveDays)
  }
}

export function createOpenCodeProvider(
  input: UsageOverviewInput['opencode']
): UsageProviderOverview {
  const summary = input.summary
  const dailyActiveDays = input.daily
    .filter((entry) => entry.totalTokens > 0)
    .map((entry) => entry.day)
  return {
    id: 'opencode',
    label: translate('auto.components.stats.usage.overview.model.bc474051e5', 'OpenCode'),
    enabled: input.scanState?.enabled ?? false,
    isScanning: input.scanState?.isScanning ?? false,
    hasData: summary?.hasAnyOpenCodeData ?? input.scanState?.hasAnyOpenCodeData ?? false,
    lastScanCompletedAt: input.scanState?.lastScanCompletedAt ?? null,
    lastScanError: input.scanState?.lastScanError ?? null,
    sessions: summary?.sessions ?? 0,
    activityLabel: 'events',
    activityCount: summary?.events ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
    newInputTokens: getOpenCodeNewInputTokens(summary),
    outputTokens: summary?.outputTokens ?? 0,
    cacheTokens: summary?.cachedInputTokens ?? 0,
    reasoningTokens: summary?.reasoningOutputTokens ?? 0,
    estimatedCostUsd: summary?.estimatedCostUsd ?? null,
    hasPartialCost: false,
    topModel: summary?.topModel ?? null,
    topProject: summary?.topProject ?? null,
    activeDays: countActiveDays(dailyActiveDays)
  }
}

export function createMuseProvider(input: UsageOverviewInput['muse']): UsageProviderOverview {
  const summary = input.summary
  const dailyActiveDays = input.daily
    .filter((entry) => entry.totalTokens > 0)
    .map((entry) => entry.day)
  return {
    id: 'muse',
    label: translate('auto.lib.agent.catalog.muse_label', 'Muse'),
    enabled: input.scanState?.enabled ?? false,
    isScanning: input.scanState?.isScanning ?? false,
    hasData: summary?.hasAnyMuseData ?? input.scanState?.hasAnyMuseData ?? false,
    lastScanCompletedAt: input.scanState?.lastScanCompletedAt ?? null,
    lastScanError: input.scanState?.lastScanError ?? null,
    sessions: summary?.sessions ?? 0,
    activityLabel: 'events',
    activityCount: summary?.events ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
    newInputTokens: getMuseNewInputTokens(summary),
    outputTokens: summary?.outputTokens ?? 0,
    cacheTokens: summary?.cachedInputTokens ?? 0,
    reasoningTokens: summary?.reasoningOutputTokens ?? 0,
    // Muse logs carry no price.
    estimatedCostUsd: null,
    hasPartialCost: false,
    topModel: summary?.topModel ?? null,
    topProject: summary?.topProject ?? null,
    activeDays: countActiveDays(dailyActiveDays)
  }
}

/** Kiro and Antigravity totals from the account ledger, which reads their session logs. */
export function createLedgerProviders(
  ledger: UsageOverviewInput['ledger']
): UsageProviderOverview[] {
  return LEDGER_ONLY_PROVIDERS.flatMap((id) => {
    const rows = ledger?.rows.filter((row) => row.provider === id) ?? []
    if (rows.length === 0) {
      return []
    }
    const days = (ledger?.daily ?? [])
      .filter((entry) => entry.provider === id && (entry.totalTokens > 0 || entry.credits > 0))
      .map((entry) => entry.day)
    const sum = (pick: (row: (typeof rows)[number]) => number): number =>
      rows.reduce((total, row) => total + pick(row), 0)
    const top = [...rows].sort((left, right) => right.totalTokens - left.totalTokens)[0]
    return [
      {
        id,
        label:
          id === 'kiro'
            ? translate('auto.lib.agent.catalog.e0247254f2', 'Kiro')
            : translate('auto.lib.agent.catalog.691dd11789', 'Antigravity'),
        enabled: true,
        isScanning: false,
        hasData: true,
        lastScanCompletedAt: null,
        lastScanError: null,
        sessions: sum((row) => row.sessions),
        activityLabel: 'events',
        activityCount: sum((row) => row.activity),
        totalTokens: sum((row) => row.totalTokens),
        newInputTokens: sum((row) => row.inputTokens),
        outputTokens: sum((row) => row.outputTokens),
        cacheTokens: sum((row) => row.cacheTokens),
        reasoningTokens: sum((row) => row.reasoningTokens),
        estimatedCostUsd: null,
        hasPartialCost: false,
        topModel: top?.topModel ?? null,
        topProject: null,
        activeDays: countActiveDays(days),
        credits: sum((row) => row.credits),
        estimated: rows.some((row) => row.estimated)
      }
    ]
  })
}
