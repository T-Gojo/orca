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
      'Covers the accounts workers can run on: Antigravity, Kiro, Codex and Claude, including saved accounts that are not active.',
      'Reads usage fresh first; --cached shows the last readings without waiting.',
      '`*` marks the login new launches use today. [skip] means at or above the preferences threshold, or failing.'
    ],
    examples: ['orca delegation usage', 'orca delegation usage --json']
  },
  {
    path: ['delegation', 'route'],
    summary: 'Pick the agent, account and model for one delegated task',
    usage:
      'orca delegation route [--agent antigravity|kiro|codex|claude] [--kind <kind>] [--cached] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'kind', 'cached'],
    notes: [
      'Takes the first agent in your preferred order (or the --kind order) that has an account under the usage threshold, on its least-used account.',
      'Prints the worker-start flags to use, and fallbacks to try if that worker runs out of usage. Exits 1 when every account is exhausted.',
      'Edit the order, models, threshold and kinds in the file `orca delegation preferences` names.'
    ],
    examples: [
      'orca delegation route',
      'orca delegation route --kind review',
      'orca delegation route --agent kiro --json'
    ]
  },
  {
    path: ['delegation', 'advice'],
    summary: 'Print the auto-delegation note a coordinator agent gets with each prompt',
    usage: 'orca delegation advice [--agent claude|codex] [--fresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'fresh'],
    notes: [
      'Names the workers with quota and tells the coordinator to delegate by default; above autoDelegation.ownUsedPercent of its own plan, to delegate all bulk work.',
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
