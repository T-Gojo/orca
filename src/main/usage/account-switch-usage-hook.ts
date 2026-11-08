// Keep import-free: account services in both the desktop app and orcad call it.
type BeforeSwitch = (provider: 'codex' | 'kiro' | 'antigravity') => Promise<void>

let beforeSwitch: BeforeSwitch | null = null

export function setBeforeAccountSwitchHook(hook: BeforeSwitch | null): void {
  beforeSwitch = hook
}

/** Lets the usage ledger credit the signed-in account before its login changes. */
export async function beforeAccountSwitch(
  provider: 'codex' | 'kiro' | 'antigravity'
): Promise<void> {
  await beforeSwitch?.(provider).catch(() => {})
}
