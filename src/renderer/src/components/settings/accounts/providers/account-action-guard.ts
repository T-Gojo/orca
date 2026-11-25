/**
 * Fork: runs one account action at a time and clears the busy state afterwards. Kept outside the
 * components because React Compiler cannot compile a try/finally inside one.
 */
export async function runGuardedAccountAction(
  pending: { current: boolean },
  mounted: { current: boolean },
  setBusy: (busy: boolean) => void,
  work: () => Promise<void>
): Promise<void> {
  if (pending.current) {
    return
  }
  pending.current = true
  setBusy(true)
  try {
    await work()
  } finally {
    pending.current = false
    if (mounted.current) {
      setBusy(false)
    }
  }
}
