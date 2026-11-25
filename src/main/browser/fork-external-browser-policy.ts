import { BrowserError } from './browser-error'

export type AgentInternalBrowserCaller = {
  clientKind?: 'mobile' | 'runtime'
  opensPageLink?: boolean
}

const INTERNAL_BROWSER_BLOCKED_MESSAGE =
  'Orca internal browser is disabled for agent flows in this fork. Use the `dusk` MCP server (for logged-in background tabs in Dusk) or the `browser-use` MCP server (to drive local Google Chrome / Chromium), and `background-computer-use` for macOS windows. Set ORCA_ALLOW_INTERNAL_BROWSER=1 to override.'

export function shouldBlockAgentInternalBrowser(caller?: AgentInternalBrowserCaller): boolean {
  if (
    process.env.ORCA_ALLOW_INTERNAL_BROWSER === '1' ||
    process.env.ORCA_BLOCK_INTERNAL_BROWSER === '0'
  ) {
    return false
  }
  if (Boolean(process.env.VITEST) && process.env.ORCA_BLOCK_INTERNAL_BROWSER !== '1') {
    return false
  }
  if (caller?.clientKind === 'mobile' || caller?.opensPageLink === true) {
    return false
  }
  return true
}

export function assertInternalBrowserAllowedForAgent(caller?: AgentInternalBrowserCaller): void {
  if (shouldBlockAgentInternalBrowser(caller)) {
    throw new BrowserError('browser_error', INTERNAL_BROWSER_BLOCKED_MESSAGE)
  }
}
