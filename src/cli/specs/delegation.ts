import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

/** Fork: usage-aware delegation of work to other agents and their saved accounts. */
export const DELEGATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['delegation', 'usage'],
    summary: 'Show how much of each agent account’s plan is used, for routing delegated work',
    usage: 'orca delegation usage [--cached] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'cached'],
    notes: [
      'Covers the accounts workers can run on: Antigravity, Kiro, Codex, Claude and Mistral Vibe (Fork), including saved accounts that are not active.',
      'Reads usage fresh first; --cached shows the last readings without waiting.',
      '`*` marks the login new launches use today. [skip] means at or above the preferences threshold, or failing.'
    ],
    examples: ['orca delegation usage', 'orca delegation usage --json']
  },
  {
    path: ['delegation', 'route'],
    summary: 'Pick the agent, account and model for one delegated task',
    usage:
      'orca delegation route [--tier light|standard|strong] [--agent antigravity|kiro|codex|claude|mistral-vibe] [--kind <kind>] [--cached] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'kind', 'tier', 'cached'],
    notes: [
      '--tier is the task’s difficulty: only agents whose model tier (preferences `profiles`) is at least that are considered.',
      'Among accounts under the usage threshold, quota that would otherwise reset unused (5h, weekly or monthly, at an even pace) goes first, then the most usable share; the preferred order breaks near-ties.',
      'Inside a Claude Code session, that session’s own Claude account is never picked.',
      'Prints the worker-start flags to use, and fallbacks to try if that worker runs out of usage. Exits 1 when every account is exhausted.',
      'Edit the order, models, threshold and kinds in the file `orca delegation preferences` names.'
    ],
    examples: [
      'orca delegation route',
      'orca delegation route --tier light',
      'orca delegation route --kind review',
      'orca delegation route --agent kiro --json'
    ]
  },
  {
    path: ['delegation', 'advice'],
    summary: 'Print the auto-delegation note a coordinator agent gets with each prompt',
    usage:
      'orca delegation advice [--agent claude|codex] [--self-account <id|system>] [--session <id>] [--fresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'self-account', 'session', 'fresh'],
    notes: [
      'A usage brief: the coordinator’s own windows and pace, every worker account’s 5h/weekly/monthly usage with reset times and quota that would reset unused, each agent’s capability tier, and the best light and strong route.',
      '--session: when the brief has not materially changed (shares to 5%) since this session’s last one within 30 minutes, prints a one-line note instead.',
      'The coordinator’s own account comes from its Claude Code session (or --self-account) and is never offered as a worker.',
      'Uses the last usage readings so it stays fast; --fresh reads usage first. Prints nothing when autoDelegation.enabled is false.',
      'The Claude Code UserPromptSubmit hook that `config/scripts/fork.sh hooks` installs runs this.'
    ],
    examples: ['orca delegation advice', 'orca delegation advice --fresh']
  },
  {
    path: ['delegation', 'preferences'],
    summary: 'Show the delegation preferences and the file to edit them in',
    usage: 'orca delegation preferences [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'agentOrder: agents to hand work to, first choice first. models: model per agent. maxUsedPercent: skip accounts at or above this share. kinds: per-kind agent order and models. autoDelegation: {enabled, ownUsedPercent} for the per-prompt delegation note.'
    ],
    examples: ['orca delegation preferences']
  }
]
