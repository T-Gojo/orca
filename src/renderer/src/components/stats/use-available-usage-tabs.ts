import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { useAccountUsageSnapshot } from './use-account-usage-snapshot'

type ScanState = { enabled: boolean } | null

function tracked(scanState: ScanState, hasData: boolean | undefined): boolean {
  return Boolean(scanState?.enabled) || hasData === true
}

/** Usage pages for agents in use: tracked, with recorded usage, and not turned off in Agents. */
export function useAvailableUsageTabs(): Set<string> {
  const disabled = useAppStore((state) => state.settings?.disabledTuiAgents)
  const claude = useAppStore((state) => state.claudeUsageScanState)
  const codex = useAppStore((state) => state.codexUsageScanState)
  const openCode = useAppStore((state) => state.openCodeUsageScanState)
  const muse = useAppStore((state) => state.museUsageScanState)
  const grokConfigured = useAppStore((state) => state.rateLimits.grokAuthConfigured)
  const { snapshot } = useAccountUsageSnapshot('all')
  return useMemo(() => {
    const ledgerProviders = new Set(snapshot?.rows.map((row) => row.provider) ?? [])
    const candidates: [TuiAgent, boolean][] = [
      ['claude', tracked(claude, claude?.hasAnyClaudeData)],
      ['codex', tracked(codex, codex?.hasAnyCodexData)],
      ['opencode', tracked(openCode, openCode?.hasAnyOpenCodeData)],
      // Why data only: Muse is often enabled with nothing to show.
      ['muse', muse?.hasAnyMuseData === true],
      ['kiro', ledgerProviders.has('kiro')],
      ['antigravity', ledgerProviders.has('antigravity')],
      ['grok', grokConfigured]
    ]
    return new Set([
      'overview',
      ...candidates
        .filter(([agent, available]) => available && isTuiAgentEnabled(agent, disabled))
        .map(([agent]) => agent)
    ])
  }, [claude, codex, openCode, muse, grokConfigured, snapshot, disabled])
}
