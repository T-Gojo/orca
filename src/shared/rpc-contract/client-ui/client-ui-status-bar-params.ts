import * as z from 'zod'

export const StatusBarItem = z.enum([
  'claude',
  'codex',
  'antigravity',
  'opencode-go',
  'kimi',
  'minimax',
  'grok',
  'cursor',
  'zcode',
  // Fork: the Kiro meter is a saved status-bar item (FORK.md §7).
  'kiro',
  'muse',
  'ssh',
  'resource-usage',
  'ports',
  'git-blame'
])

// Older clients still list the removed Gemini CLI usage item; drop it instead of rejecting their list.
export const StatusBarItems = z
  .array(z.union([StatusBarItem, z.literal('gemini')]))
  .transform((items) =>
    items.filter((item): item is z.infer<typeof StatusBarItem> => item !== 'gemini')
  )
