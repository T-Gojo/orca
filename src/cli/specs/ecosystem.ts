import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

/** Fork: single-command Unified Ecosystem CLI (`orca ecosystem ...`) across Rikugan, Hermes & OpenClaw (§16). */
export const ECOSYSTEM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ecosystem', 'up'],
    summary:
      'Start Rikugan, Mac-standalone OpenClaw bridge (:6770), Orca-Hermes MCP, and park duplicate daemons',
    usage: 'orca ecosystem up [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca ecosystem up']
  },
  {
    path: ['ecosystem', 'down'],
    summary: 'Stop the local OpenClaw Telegram/WhatsApp/HTTP bridge daemon',
    usage: 'orca ecosystem down [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca ecosystem down']
  },
  {
    path: ['ecosystem', 'status'],
    summary:
      'Show live health of Rikugan (:5680), Hermes Suite, Telegram, WhatsApp, and Unified Endpoint (:6770)',
    usage: 'orca ecosystem status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca ecosystem status', 'orca ecosystem status --json']
  },
  {
    path: ['ecosystem', 'sync'],
    summary: 'Sync Rikugan, Orca-Hermes PTC, and external browser MCPs across all 6 CLIs',
    usage: 'orca ecosystem sync [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca ecosystem sync']
  },
  {
    path: ['ecosystem', 'ask'],
    summary:
      'Send a Rikugan-enriched prompt to the unified Orca control plane and optionally wait for the reply',
    usage:
      'orca ecosystem ask --prompt <text> [--wait] [--source <name>] [--thread <id>] [--sender <name>] [--agent <agent>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'prompt', 'wait', 'source', 'thread', 'sender', 'agent'],
    examples: [
      'orca ecosystem ask --prompt "Summarize my recent open threads from Rikugan" --wait',
      'orca ecosystem ask --prompt "Check git status in Orca" --json'
    ]
  },
  {
    path: ['ecosystem', 'review'],
    summary: 'Dispatch an independent Hermes-style senior code & security reviewer in Orca',
    usage: 'orca ecosystem review [--focus <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'focus'],
    examples: ['orca ecosystem review --focus "ecosystem auth and pairing"']
  },
  {
    path: ['ecosystem', 'learn'],
    summary:
      'Distill a Hermes-standard SKILL.md (<=60-char routing description, Undo backup) across all 6 CLIs',
    usage: 'orca ecosystem learn --topic <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'topic'],
    examples: ['orca ecosystem learn --topic "Thunder SSD build cache routing"']
  },
  {
    path: ['ecosystem', 'undo-skill'],
    summary:
      'Revert a newly created or patched Hermes skill across ~/.agents/skills and all 6 CLIs',
    usage: 'orca ecosystem undo-skill --skill <name-or-backup-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill'],
    examples: ['orca ecosystem undo-skill --skill ssd-cache-routing']
  },
  {
    path: ['ecosystem', 'skills'],
    summary: 'Search or install skills from local domain packs and GitHub via Hermes Skills Hub',
    usage: 'orca ecosystem skills [--search <query>] [--install <name-or-url>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'search', 'install'],
    examples: [
      'orca ecosystem skills --search "remotion"',
      'orca ecosystem skills --install "security-audit"'
    ]
  },
  {
    path: ['ecosystem', 'pair'],
    summary: 'Approve a 6-digit Telegram or WhatsApp DM pairing code',
    usage: 'orca ecosystem pair --code <6-digit-code> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'code'],
    examples: ['orca ecosystem pair --code 482910']
  },
  {
    path: ['ecosystem', 'telegram'],
    summary: 'Configure the Telegram Bot token stored in ~/.config/orca-ecosystem/.env (0600)',
    usage: 'orca ecosystem telegram --token <bot-token> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'token'],
    examples: ['orca ecosystem telegram --token 123456:ABC...']
  },
  {
    path: ['ecosystem', 'whatsapp'],
    summary: 'Start WhatsApp Web multi-device QR pairing or log out',
    usage: 'orca ecosystem whatsapp [--login] [--logout] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'login', 'logout'],
    examples: ['orca ecosystem whatsapp --login', 'orca ecosystem whatsapp --logout']
  },
  {
    path: ['ecosystem', 'notify'],
    summary: 'Send a proactive outbound message to paired Telegram or WhatsApp',
    usage: 'orca ecosystem notify --message <text> [--channel auto|telegram|whatsapp] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'message', 'channel'],
    examples: ['orca ecosystem notify --message "Build finished on Mac"']
  }
]
