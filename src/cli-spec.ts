// Command registry: the single source of truth that drives BOTH help rendering
// and (the intent of) parsing, so the two can never drift. clig.dev: a
// self-describing CLI whose --help is the agent's tool menu.

export interface ArgSpec {
  name: string;
  required: boolean;
  description: string;
}

export interface FlagSpec {
  name: string;
  takesValue: boolean;
  default?: string;
  description: string;
}

export interface CommandSpec {
  name: string;
  summary: string; // one-line "use this when..."
  args: ArgSpec[]; // positional
  flags: FlagSpec[];
  example: string; // e.g. 'webnav recall "python retry" --top 5'
}

export const VERSION = '0.1.0';

export const COMMANDS: CommandSpec[] = [
  {
    name: 'list',
    summary: 'List everything webnav knows: sites, locatable places, goals.',
    args: [],
    flags: [],
    example: 'webnav list',
  },
  {
    name: 'describe',
    summary: 'Describe a known place: its address and what you can do there.',
    args: [
      { name: 'place', required: true, description: 'Name of a known place to describe.' },
    ],
    flags: [],
    example: 'webnav describe "trending repositories"',
  },
  {
    name: 'locate',
    summary: 'Find WHERE a place is (its URL coordinate) WITHOUT navigating to it.',
    args: [
      { name: 'place', required: true, description: 'Name of a known place to locate.' },
    ],
    flags: [],
    example: 'webnav locate "trending repositories"',
  },
  {
    name: 'recall',
    summary:
      'Navigate GitHub for a use-case and return an evidence bundle of candidate repos (the agent ranks).',
    args: [
      { name: 'query', required: true, description: 'The use-case to search GitHub for.' },
    ],
    flags: [
      {
        name: '--top',
        takesValue: true,
        default: '10',
        description: 'Maximum number of candidate repos to gather.',
      },
    ],
    example: 'webnav recall "python retry" --top 5',
  },
  {
    name: 'search',
    summary:
      'Search the open web for a query: visit top-N results and return extracted answer-evidence.',
    args: [
      { name: 'query', required: true, description: 'The query to search the open web for.' },
    ],
    flags: [
      {
        name: '--top',
        takesValue: true,
        default: '3',
        description: 'Number of top results to visit and extract evidence from.',
      },
    ],
    example: 'webnav search "who won the 2018 world cup" --top 3',
  },
  {
    name: 'route',
    summary:
      'Ask the graph which site(s) to use for a request (returns candidates + signals; you decide).',
    args: [
      { name: 'request', required: true, description: 'The request to route to candidate sites.' },
    ],
    flags: [
      {
        name: '--capability',
        takesValue: true,
        description:
          'Explicit capability/cluster to route to (e.g. web-search). Alias: --cap. If omitted, the request is matched against declared tokens.',
      },
    ],
    example: 'webnav route "find a python retry library"',
  },
  {
    name: 'hop',
    summary: 'Move from the current page to a related site in the graph.',
    args: [
      { name: 'url', required: true, description: 'The current page URL to hop from.' },
    ],
    flags: [
      {
        name: '--to-cluster',
        takesValue: true,
        description: 'Capability/cluster to hop into (any related node serving it).',
      },
      {
        name: '--to-node',
        takesValue: true,
        description: 'Specific node id to hop to.',
      },
    ],
    example: 'webnav hop https://github.com/jd/tenacity --to-cluster package-search',
  },
  {
    name: 'capture',
    summary: 'Dev helper: open a URL and save its snapshot YAML to a file (for test fixtures).',
    args: [
      { name: 'url', required: true, description: 'URL to open and snapshot.' },
      { name: 'out', required: true, description: 'Output file path for the snapshot YAML.' },
    ],
    flags: [],
    example: 'webnav capture https://github.com out.yml',
  },
];
