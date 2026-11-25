import { useCallback } from 'react'
import { useAgentPresentation } from '@/components/sidebar/workspace-card/activity/useWorktreeAgentRows'

/** Fork: reactive count of active (working + waiting/blocked) background agent tasks via keyed projection (FORK.md §13). */
export function useActiveBackgroundTaskCount(): number {
  return useAgentPresentation(
    'dashboard-counts',
    useCallback((projection) => {
      const counts = projection.dashboardCounts()
      return counts.working + counts.attention
    }, [])
  )
}
