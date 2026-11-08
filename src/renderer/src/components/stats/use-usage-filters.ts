import { useCallback } from 'react'
import { useAppStore } from '../../store'
import type { ClaudeUsageRange, ClaudeUsageScope } from '../../../../shared/claude-usage-types'

export type UsageRange = ClaudeUsageRange
export type UsageScope = ClaudeUsageScope

/**
 * One range and scope for every usage view. Why: the Overview sums each provider's own selection,
 * so a filter changed on one provider's page used to make the Overview total disagree with itself.
 */
export function useUsageFilters(): {
  range: UsageRange
  scope: UsageScope
  setRange: (range: UsageRange) => void
  setScope: (scope: UsageScope) => void
} {
  // Claude's selection stands for all: every change below goes to every provider together.
  const range = useAppStore((state) => state.claudeUsageRange)
  const scope = useAppStore((state) => state.claudeUsageScope)
  const setRange = useCallback((next: UsageRange) => {
    const state = useAppStore.getState()
    void Promise.all([
      state.setClaudeUsageRange(next),
      state.setCodexUsageRange(next),
      state.setOpenCodeUsageRange(next),
      state.setMuseUsageRange(next)
    ])
  }, [])
  const setScope = useCallback((next: UsageScope) => {
    const state = useAppStore.getState()
    void Promise.all([
      state.setClaudeUsageScope(next),
      state.setCodexUsageScope(next),
      state.setOpenCodeUsageScope(next),
      state.setMuseUsageScope(next)
    ])
  }, [])
  return { range, scope, setRange, setScope }
}
