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
  group?: 'find' | 'read' | 'navigate';
  summary: string; // one-line "use this when..."
  args: ArgSpec[]; // positional
  flags: FlagSpec[];
  example: string; // e.g. 'webnav recall "python retry" --top 5'
}

export const VERSION = '0.1.0';

export const CONSUMER_COMMANDS: CommandSpec[] = [
  {
    name: 'locate',
    group: 'find',
    summary: 'Find WHERE a place is (its URL coordinate) WITHOUT navigating to it.',
    args: [
      { name: 'place', required: true, description: 'A known place name (list via `webnav dev list`).' },
    ],
    flags: [],
    example: 'webnav locate "trending repositories"',
  },
  {
    name: 'read',
    group: 'read',
    summary: 'Open a URL and return its distilled content (use --raw for the full page snapshot).',
    args: [{ name: 'url', required: true, description: 'A URL to open — e.g. a coordinate from `locate`.' }],
    flags: [{ name: '--raw', takesValue: false, description: 'Return the full page snapshot instead of distilled content.' }],
    example: 'webnav read https://github.com/psf/requests',
  },
  {
    name: 'recall',
    group: 'read',
    summary: 'Replay the known route for a goal and return an evidence bundle (the agent ranks). Run list-goals for goal ids.',
    args: [
      { name: 'goal', required: false, description: 'Goal id from `list-goals` (defaults to github-repos).' },
      { name: 'query', required: true, description: 'Search term fed into the goal\'s entry.' },
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
    group: 'read',
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
    group: 'find',
    summary:
      'Ask the graph which site(s) to use for a request (returns candidates + signals; you decide).',
    args: [
      { name: 'request', required: true, description: 'What you want to do; returns candidate sites to act on.' },
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
    group: 'navigate',
    summary: 'Move from the current page to a related site in the graph.',
    args: [
      { name: 'url', required: true, description: 'The page URL you are currently on.' },
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
    name: 'eval',
    group: 'navigate',
    summary: 'Open a URL and run a JS expression in the page — returns just the value (cheap, targeted extraction).',
    args: [
      { name: 'url', required: true, description: 'A URL to open.' },
      { name: 'js', required: true, description: 'A () => <value> JS expression evaluated in the page; its return value is returned.' },
    ],
    flags: [],
    example: 'webnav eval https://github.com/psf/requests "() => document.title"',
  },
  {
    name: 'network',
    group: 'navigate',
    summary: 'Open a URL and return the network/API calls the page made (often the JSON behind the rendered DOM).',
    args: [{ name: 'url', required: true, description: 'A URL to open.' }],
    flags: [],
    example: 'webnav network https://api-backed-site.example',
  },
  {
    name: 'go-back',
    group: 'navigate',
    summary: 'Step back in a browser session (pass --session to target one you are driving).',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Browser session name to act on (default: webnav-nav).' }],
    example: 'webnav go-back --session mysession',
  },
  {
    name: 'reload',
    group: 'navigate',
    summary: 'Reload the page in a browser session (pass --session to target one you are driving).',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Browser session name to act on (default: webnav-nav).' }],
    example: 'webnav reload --session mysession',
  },
  {
    name: 'list-goals',
    group: 'find',
    summary: 'List the recall goals webnav knows: id, what it does, and the signals it returns.',
    args: [],
    flags: [],
    example: 'webnav list-goals',
  },
  {
    name: 'walk', group: 'navigate',
    summary: 'Walk a multi-step route to a non-URL state (pathfinds over the graph; pauses at forks for the agent).',
    args: [],
    flags: [
      { name: '--start', takesValue: true, description: 'Start state id (from `dev graph-show`).' },
      { name: '--goal', takesValue: true, description: 'Goal state id to reach.' },
      { name: '--input', takesValue: true, description: 'Runtime input slot=value (repeatable; never stored).' },
    ],
    example: 'webnav walk --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-overview --input username=u --input password=p',
  },
  {
    name: 'walk-resume', group: 'navigate',
    summary: 'Continue a paused walk: answer the fork it stopped on.',
    args: [{ name: 'session', required: true, description: 'Walk session id from a paused `walk`.' }],
    flags: [
      { name: '--ref', takesValue: true, description: 'Element ref (answers needs-navigation; from the snapshot).' },
      { name: '--classify', takesValue: true, description: 'safe | commit (answers needs-classification; commit halts).' },
    ],
    example: 'webnav walk-resume walk-w-123 --ref e42',
  },
  {
    name: 'navigate', group: 'navigate',
    summary: 'Open a URL in a session browser; records a landing observation if the session is recording.',
    args: [{ name: 'url', required: true, description: 'URL to open.' }],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer; from `dev record-start`).' }],
    example: 'webnav use navigate https://www.saucedemo.com --session sd1',
  },
  {
    name: 'snapshot', group: 'navigate',
    summary: 'Return the current page snapshot as JSON {snapshot: "<yaml>"} (read refs from .snapshot to act on). Never records.',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Session id whose live browser to snapshot.' }],
    example: 'webnav use snapshot --session sd1',
  },
  {
    name: 'click', group: 'navigate',
    summary: 'Click an element by ref (from `use snapshot`); records the before/after action-effect if recording.',
    args: [{ name: 'ref', required: true, description: 'Element ref from a prior `use snapshot`.' }],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer).' }],
    example: 'webnav use click e42 --session sd1',
  },
  {
    name: 'type', group: 'navigate',
    summary: 'Type text into a field by ref (from `use snapshot`); records the action-effect if recording.',
    args: [
      { name: 'ref', required: true, description: 'Field ref from a prior `use snapshot`.' },
      { name: 'text', required: true, description: 'Text to type into the field.' },
    ],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer).' }],
    example: 'webnav use type e1 standard_user --session sd1',
  },
];

export const DEV_COMMANDS: CommandSpec[] = [
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
    name: 'graph',
    summary: 'Show the map of known sites (the internet graph) as JSON.',
    args: [],
    flags: [
      {
        name: '--json',
        takesValue: false,
        description: 'Emit JSON (it is already JSON — kept for flag consistency).',
      },
    ],
    example: 'webnav graph > map.json',
  },
  {
    name: 'node-add',
    summary: 'Teach webnav a new site: its id, url, capabilities, topics.',
    args: [
      { name: 'id', required: true, description: 'Node id (e.g. npmjs.com) — also the skeleton namespace.' },
    ],
    flags: [
      { name: '--url', takesValue: true, description: 'Entry/home URL for the site.' },
      { name: '--capabilities', takesValue: true, description: 'Comma-separated capability/cluster names this site serves.' },
      { name: '--topics', takesValue: true, description: 'Comma-separated declared content topics.' },
    ],
    example: 'webnav dev node-add npmjs.com --url https://www.npmjs.com --capabilities package-search --topics javascript,packages',
  },
  {
    name: 'edge-add',
    summary: 'Teach webnav a relationship between two known sites.',
    args: [
      { name: 'from', required: true, description: 'Source node id (must already be known).' },
      { name: 'to', required: true, description: 'Target node id (must already be known).' },
    ],
    flags: [
      { name: '--kind', takesValue: true, default: 'capability', description: 'Edge kind: capability | hyperlink | co-use | content.' },
    ],
    example: 'webnav dev edge-add github.com pypi.org --kind hyperlink',
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
  {
    name: 'record-start',
    summary: 'Begin a record session: pages you browse via webnav are captured for mapping.',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id (defaults to a generated one).' }],
    example: 'webnav dev record-start --session map-1',
  },
  {
    name: 'record-stop',
    summary: 'End a record session (stop capturing pages).',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id from `dev record-start`.' }],
    example: 'webnav dev record-stop --session map-1',
  },
  {
    name: 'graph-analyse',
    summary: 'Mechanically derive a per-site navigation structure from a record session (data only — the agent names + validates it).',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id from `dev record-start`.' }],
    example: 'webnav dev graph-analyse --session map-1',
  },
  {
    name: 'graph-edit',
    summary: 'Upsert a validated navigation graph into a site-node interior (creates the node if new).',
    args: [],
    flags: [
      { name: '--node', takesValue: true, description: 'Site-node id (host), e.g. github.com.' },
      { name: '--graph', takesValue: true, description: 'JSON {states:[{label,urlPattern?,fingerprint?}], edges:[{from,to,via,needsInput?,why?}]}.' },
    ],
    example: 'webnav dev graph-edit --node github.com --graph \'{"states":[],"edges":[]}\'',
  },
  {
    name: 'graph-show',
    summary: 'Read a site-node\'s persisted navigation skeleton (states + edges).',
    args: [],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (host), e.g. github.com.' }],
    example: 'webnav dev graph-show --node github.com',
  },
  {
    name: 'outline',
    summary: 'Human-scannable text outline of a site\'s interior (states + typed affordances), with completeness cues: unexplored exits, dead-ends, orphans, per-kind counts. Answers "did we capture everything?" without the UI.',
    args: [{ name: 'site', required: true, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' }],
    example: 'webnav dev outline www.saucedemo.com',
  },
  {
    name: 'mermaid',
    summary: 'Emit a Mermaid stateDiagram-v2 of a site\'s interior — paste into GitHub/markdown/mermaid.live to render a diagram (no React Flow). Unexplored exits → an "unexplored" sink; dead-ends marked terminal.',
    args: [{ name: 'site', required: true, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' }],
    example: 'webnav dev mermaid www.saucedemo.com',
  },
  {
    name: 'standalone',
    summary: 'Write a SINGLE self-contained HTML file that renders a site\'s interior graph offline (inlines the React Flow bundle + the graph data) — open it by double-clicking, no server. Requires `npm --prefix web run build` first.',
    args: [{ name: 'site', required: true, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [
      { name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' },
      { name: '--out', takesValue: true, description: 'Output HTML path (default: <site>-graph.html in cwd).' },
    ],
    example: 'webnav dev standalone www.saucedemo.com --out saucedemo.html',
  },
];

export const COMMANDS: CommandSpec[] = [...CONSUMER_COMMANDS, ...DEV_COMMANDS];
