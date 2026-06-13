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

// Browser-launch flags shared by every verb that opens a browser (read / navigate
// / walk). Default is HEADED (a visible window); --headless opts out.
export const BROWSER_FLAGS: FlagSpec[] = [
  { name: '--headless', takesValue: false, description: 'Run without a visible browser window (CI / servers). Default is headed — a real visible window.' },
  { name: '--headed', takesValue: false, description: 'Show a real browser window (the default; kept as an explicit no-op for back-compat).' },
  { name: '--persistent', takesValue: false, description: 'Reuse a persistent browser profile so a logged-in session survives across runs.' },
  { name: '--profile', takesValue: true, description: 'Persistent profile directory (implies --persistent).' },
  { name: '--browser', takesValue: true, description: 'Engine/channel: chrome | firefox | webkit | msedge.' },
];

export const CONSUMER_COMMANDS: CommandSpec[] = [
  {
    name: 'read',
    group: 'read',
    summary: 'Open a URL and return its distilled content (use --raw for the full page snapshot).',
    args: [{ name: 'url', required: true, description: 'A URL to open and read.' }],
    flags: [
      { name: '--raw', takesValue: false, description: 'Return the full page snapshot instead of distilled content.' },
      ...BROWSER_FLAGS,
    ],
    example: 'webnav read https://github.com/psf/requests',
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
    name: 'walk', group: 'navigate',
    summary: 'Walk a multi-step route to a non-URL state (pathfinds over the graph; pauses at forks for the agent).',
    args: [],
    flags: [
      { name: '--start', takesValue: true, description: 'Start state id (from `dev graph-show`).' },
      { name: '--goal', takesValue: true, description: 'Goal state id to reach.' },
      { name: '--input', takesValue: true, description: 'Runtime input slot=value (repeatable; never stored). Stored creds are used if set.' },
      { name: '--hosted', takesValue: false, description: 'Use the HOSTED shared map: fetch this site\'s map live from the webnav service (needs `webnav login <key>`) instead of the local map. Credentials still stay local.' },
      ...BROWSER_FLAGS,
    ],
    example: 'webnav walk --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-overview --headed',
  },
  {
    name: 'login', group: 'navigate',
    summary: 'Save your hosted-route API key (from the webnav site) to ~/.webnav/config.json so `walk --hosted` can fetch shared maps. The key is NOT a credential and is stored separately from site logins.',
    args: [{ name: 'key', required: true, description: 'The API key issued on the webnav website.' }],
    flags: [],
    example: 'webnav login wn_live_xxx',
  },
  {
    name: 'walk-resume', group: 'navigate',
    summary: 'Continue a paused walk: answer the fork it stopped on.',
    args: [{ name: 'session', required: true, description: 'Walk session id from a paused `walk`.' }],
    flags: [
      { name: '--ref', takesValue: true, description: 'Element ref (answers needs-navigation; from the snapshot).' },
      { name: '--classify', takesValue: true, description: 'safe | commit (answers needs-classification; commit halts).' },
      { name: '--input', takesValue: true, description: 'Re-supply a one-off slot=value from the original `walk` (repeatable; runtime-only, never stored — stored creds are rebuilt automatically).' },
    ],
    example: 'webnav walk-resume walk-w-123 --ref e42',
  },
  {
    name: 'creds', group: 'navigate',
    summary: 'Store login/form credentials LOCALLY per site (~/.webnav/credentials.json, chmod 600; never in the map, never transmitted). A walk auto-fills its input slots from these. Subcommands: set <site> key=value… | list (key names only) | rm <site> [key].',
    args: [{ name: 'sub', required: true, description: 'set | list | rm' }],
    flags: [],
    example: 'webnav creds set www.saucedemo.com username=standard_user password=secret_sauce',
  },
  {
    name: 'navigate', group: 'navigate',
    summary: 'Open a URL in a session browser; records a landing observation if the session is recording.',
    args: [{ name: 'url', required: true, description: 'URL to open.' }],
    flags: [
      { name: '--session', takesValue: true, description: 'Session id (browser + record buffer; from `dev record-start`).' },
      ...BROWSER_FLAGS,
    ],
    example: 'webnav use navigate https://www.saucedemo.com --session sd1 --headed',
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
    name: 'export-map',
    summary: 'Emit a site\'s full map pack {node, states} as JSON (skeleton only — never credentials). The unit a hosted service publishes; pipe it wherever maps are shared.',
    args: [{ name: 'site', required: true, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' }],
    example: 'webnav dev export-map www.saucedemo.com > saucedemo-map.json',
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
    name: 'effects',
    summary: 'Dump a record session\'s RAW action-effects (full before/after snapshots + diff + navigated) as JSON — the unabridged data `graph-analyse` only summarizes.',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id from `dev record-start`.' }],
    example: 'webnav dev effects --session map-1',
  },
  {
    name: 'sessions',
    summary: 'List or reap playwright-cli browser sessions. They are DAEMONIZED (survive the CLI exiting) so `use`/`walk-resume` can reattach — but a paused-and-abandoned walk or a stopped `use` exploration leaks a Chrome forever. `list` shows each session + age + whether its browser is still live; `reap` closes them.',
    args: [{ name: 'sub', required: false, description: 'list (default) | reap' }],
    flags: [
      { name: '--all', takesValue: false, description: 'reap: close EVERY session (default closes only orphans whose browser already died).' },
      { name: '--max-age-hours', takesValue: true, description: 'reap: also close LIVE sessions older than N hours (a TTL sweep).' },
    ],
    example: 'webnav dev sessions reap            # close dead-browser orphans\nwebnav dev sessions reap --all      # close everything\nwebnav dev sessions list\n# Auto-sweep (opt-in): set WEBNAV_SESSION_TTL_HOURS=6 so walk/use-navigate reap\n# orphans + sessions older than 6h on start (never the one in use). Off by default.',
  },
  {
    name: 'mcp',
    summary: 'Serve every webnav verb as MCP tools over stdio (Model Context Protocol) — point an MCP client\'s command at `webnav mcp`. Tools are generated from this spec; each call runs the real CLI.',
    args: [],
    flags: [],
    example: 'webnav mcp',
  },
  {
    name: 'dashboard',
    summary: 'Open a LOCAL operator UI (localhost only) to inspect which sites webnav has data for, view a site\'s JSON map, and manage stored credentials (grouped by category, masked with reveal + inline edit). Reads ./webnav.db + ~/.webnav/credentials.json; the only writes are credential set/remove/recategorize (chmod 600).',
    args: [],
    flags: [{ name: '--port', takesValue: true, default: '7777', description: 'Port to bind on 127.0.0.1 (or set WEBNAV_PORT). The dashboard runs until Ctrl-C.' }],
    example: 'webnav dev dashboard --port 7777',
  },
];

export const COMMANDS: CommandSpec[] = [...CONSUMER_COMMANDS, ...DEV_COMMANDS];
