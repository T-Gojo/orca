import type { HandlerGroup } from '../dispatch/handler-group-manifest'

/** Fork: CLI handler group for `orca ecosystem ...` (§16). */
export const ECOSYSTEM_HANDLER_GROUP: HandlerGroup = {
  name: 'ecosystem',
  keys: [
    'ecosystem up',
    'ecosystem down',
    'ecosystem status',
    'ecosystem sync',
    'ecosystem ask',
    'ecosystem review',
    'ecosystem learn',
    'ecosystem undo-skill',
    'ecosystem skills',
    'ecosystem pair',
    'ecosystem telegram',
    'ecosystem whatsapp',
    'ecosystem notify'
  ],
  load: async () => (await import('./ecosystem-handlers.js')).ECOSYSTEM_HANDLERS
}
