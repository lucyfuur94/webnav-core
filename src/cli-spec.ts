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

// Single source of truth: read the version from package.json at runtime (no
// resolveJsonModule needed, and no hand-maintained constant to drift). Works from
// both src/ (tsx) and dist/ — ../package.json resolves to the repo root either way.
import { readFileSync as _readVersionFile } from 'node:fs';
import { fileURLToPath as _versionUrl } from 'node:url';
export const VERSION: string = (() => {
  try {
    return JSON.parse(_readVersionFile(_versionUrl(new URL('../package.json', import.meta.url)), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

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
    name: 'close',
    group: 'navigate',
    summary: 'Close a browser session and free its window (the `use` verbs keep a session alive between calls; call this when done).',
    args: [{ name: 'session', required: false, description: 'Session to close (or use --session).' }],
    flags: [{ name: '--session', takesValue: true, description: 'Browser session name to close.' }],
    example: 'webnav use close --session mysession',
  },
  {
    name: 'session',
    group: 'navigate',
    summary: 'Interactive long-lived agent session: opens ONE browser (+ video + recording), then reads JSON-line commands on stdin and writes JSON results on stdout until quit/EOF. The shape that gives agent recordings video with no leaked windows.',
    args: [],
    flags: [
      { name: '--session', takesValue: true, description: 'Session name (required).' },
      { name: '--url', takesValue: true, description: 'Start URL (default about:blank).' },
      { name: '--profile', takesValue: true, description: 'Named profile to run under (shared login); e.g. default.' },
      { name: '--headless', takesValue: false, description: 'Run headless (recommended for agents/tests).' },
    ],
    example: 'echo \'{"cmd":"snapshot"}\' | webnav use session --session s1 --url https://example.com --headless',
  },
  {
    name: 'walk', group: 'navigate',
    summary: 'Walk a multi-step route to a non-URL state (pathfinds over the graph; pauses at forks for the agent). Response protocol: {status:"done",evidence} reached the goal (evidence carries `snapshot`+`repertoire` too when the GOAL state is dynamic — see --observe-dynamic) · {status:"needs-navigation",...} real drift, agent supplies a ref · {status:"needs-classification",...} a possibly-destructive action, agent classifies safe|commit · {status:"needs-auth",profile,site,loginUrl,at} a settled landing classified as an SSO/login wall THAT SURVIVED a fresh-session retry under the same --profile (a stale-login pattern, not evasion) — this is a FAIL, not a resumable pause: log in by hand in that profile, then re-run `walk` · {status:"checkpoint",at,state,snapshot,repertoire} a CONFIRMED arrival at a state you asked to observe — the live page + that state\'s stored affordance repertoire, so you don\'t have to snapshot manually; resume with `walk-resume <session> --continue` (fires at most once per state per walk; you may also fire `use` actions on the session before continuing — that\'s the designed pattern) · {status:"failed",reason}.',
    args: [],
    flags: [
      { name: '--start', takesValue: true, description: 'Start state id (from `dev graph-show`).' },
      { name: '--goal', takesValue: true, description: 'Goal state id to reach.' },
      { name: '--input', takesValue: true, description: 'Runtime input slot=value (repeatable; never stored). Stored creds are used if set.' },
      { name: '--hosted', takesValue: false, description: 'Use the HOSTED shared map: fetch this site\'s map live from the webnav service (needs `webnav login <key>`) instead of the local map. Credentials still stay local.' },
      { name: '--observe', takesValue: true, description: 'Pause with a checkpoint on ARRIVAL at this state (id or semanticName; repeatable). Opt-in — walk stays a zero-token autopilot unless you ask to observe something.' },
      { name: '--observe-dynamic', takesValue: false, description: 'Pause with a checkpoint on arrival at ANY state the map marks dynamic (provisional, or carrying a row/widget-scoped affordance) — for content that changes between visits.' },
      ...BROWSER_FLAGS,
    ],
    example: 'webnav walk --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-overview --headed --observe-dynamic',
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
      { name: '--continue', takesValue: false, description: 'Answers a checkpoint pause (--observe/--observe-dynamic) — proceed with no action. You may fire `use` actions on the session\'s browser first (the designed pattern); errors with a hint if the session actually paused on a different kind (needs-navigation/needs-classification instead).' },
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
    name: 'test', group: 'navigate',
    summary: 'Run a RELEASE SUITE against a site: "is everything still good?" as one command. A suite (*.suite.json) is a list of declarative walk cases; each case walks a route on AUTOPILOT and asserts checkpoints. The zero-answer philosophy: the runner answers NOTHING — a case that escalates (needs-navigation on drift, or needs-classification at a commit point) FAILS, because a release check has no judge and must never place an order or guess a fork. So the assertions are structural, not behavioral. Suite format: {site, profile?, cases:[{name, start, goal, observe?:[state], expect?:{status?, maxInteractions?, checkpoint?:{<state>:{repertoireContains?:[label], kinds?:{label:kind}, snapshotContains?:[substr]}}}}]}. `start`/`goal`/`observe` are state ids or bare semanticNames (from `dev graph-show --node <site>`). Execution: auth pre-flight ONCE (profile-status against the site\'s map — needs-login fails the WHOLE run fast with the login hint), then each case SERIALLY in a FRESH headless browser (reaped between). maxInteractions defaults 0 (pure autopilot); ANY needs-* beyond it fails the case with the pause payload as diagnostics. Output: {status:"ok"|"failed", passed, failed, cases:[{name, verdict, elapsedMs, failure?:{at, payload}}]}. Exit 0 all-pass · 3 any-fail · 2 bad suite/config. Progress → stderr. A worked example suite ships under packs/suites/.',
    args: [],
    flags: [
      { name: '--suite', takesValue: true, description: 'Path to a *.suite.json file (the release cases).' },
      { name: '--headless', takesValue: false, description: 'Run without a visible window (recommended — a suite opens a fresh browser per case).' },
    ],
    example: 'webnav test --suite packs/suites/mysite.suite.json --headless',
  },
  {
    name: 'navigate', group: 'navigate',
    summary: 'Open a URL in a session browser; records a landing observation if the session is recording. If the settled landing classifies as an SSO/login wall (foreign-host bounce, interstitial, or a password field — checked against the target site\'s own map), the JSON output adds `authWall: true, loginUrl`. NEVER auto-retried here (a recording captures what actually happened, judgment-free) — that\'s `walk`\'s job.',
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
    summary: 'List the sites webnav has a map for, with each site\'s state count. The index of your maps; inspect one with `dev graph-show` / `dev outline`.',
    args: [],
    flags: [],
    example: 'webnav dev list',
  },
  {
    name: 'node-add',
    summary: 'Teach webnav a new site: its id and home url.',
    args: [
      { name: 'id', required: true, description: 'Node id (e.g. npmjs.com) — also the skeleton namespace.' },
    ],
    flags: [
      { name: '--url', takesValue: true, description: 'Entry/home URL for the site.' },
    ],
    example: 'webnav dev node-add npmjs.com --url https://www.npmjs.com',
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
    name: 'record-live',
    summary: 'Record a site by BROWSING it yourself: opens a headed browser you click through; every action is captured (real-a11y snapshots) into the record buffer. Stop with `dev record-stop --session S` (or Ctrl-C), then `dev graph-analyse --session <S> --draft`. Secret rule: typed values are never recorded.',
    args: [],
    flags: [
      { name: '--session', takesValue: true, description: 'Record session id (also the browser session).' },
      { name: '--url', takesValue: true, description: 'Where the recording starts (the site to map).' },
      { name: '--interval', takesValue: true, description: 'Poll interval ms (default 500).' },
    ],
    example: 'webnav dev record-live --session map-1 --url https://www.saucedemo.com',
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
    summary: 'Mechanically derive a per-site navigation structure from one OR MORE record sessions. Default: raw observations (data only). With --draft: a ready, SELF-VERIFIED {node,states,edges} graph-edit spec (absolute URLs, uniqueness fingerprints, resolvable edges, login wired) — one logical page = one state (in-page tabs/search/sort do NOT split it), and multiple sessions of the same site MERGE into one map. A state seen only once is marked `provisional` (identity unconfirmed) and its `receipt.requests` lists what to record again to confirm it — check requests, drive those states once more, re-draft. A synthetic `_shell` state (role shell) carries the site-wide chrome (nav/header/footer) as from-anywhere edges, not a page. Repeated widget/card/row subtrees (e.g. dashboard chart widgets, table rows) fold into single `scope:\'widget\'|\'row\'` template affordances, and personalized pages built from the same widget templates merge on that template identity rather than staying separate per instance. APPROVAL GATE: only sessions whose capture-review PASSED (`dev review`) are built from; a failed or never-reviewed session is excluded (reported as excludedUnverified) so the map is never trained on an untrusted capture. Drive a site, review each session until it passes, then `--draft` and pipe to graph-edit. THE EXTENSION LOOP: --draft also reports `unknowns` — everything the core\'s structural inference honestly could not resolve (an undetected overlay, a degenerate/ambiguous landing, an affordance self-verify flagged, or a pattern pack disabled for over-excising a page — each with capped evidence + context + the extensionPoint it plugs into). Feed an unknown to `dev pattern-propose --from-unknown <this-output>#<index> --name <slug>` to scaffold a declarative pattern-pack entry in `packs/patterns/proposed/`; once it lints clean it applies locally on the next --draft, and a PR upstream shares it (see docs/EXTENDING.md). Packs are DATA — never hand-patch this engine\'s code for a site-specific gap.',
    args: [],
    flags: [
      { name: '--session', takesValue: true, description: 'Record session id. REPEATABLE — pass several to merge multiple drives of one site into one draft.' },
      { name: '--host', takesValue: true, description: 'Auto-include EVERY recorded session for this host (e.g. www.saucedemo.com) — drafts the whole site from all its drives at once.' },
      { name: '--draft', takesValue: false, description: 'Emit a ready-to-edit graph spec (states+affordances) instead of raw observations; `_warning` flags anything the self-verify found shaky.' },
      { name: '--skip-review-gate', takesValue: false, description: 'Build from ALL given sessions even if unreviewed/failed (bypasses the approval gate — for a deliberate raw build).' },
    ],
    example: 'webnav dev graph-analyse --host www.saucedemo.com --draft   # or: --session a --session b',
  },
  {
    name: 'pattern-propose',
    summary: 'THE EXTENSION LOOP, step 2: turn ONE entry from a `graph-analyse --draft` JSON\'s `unknowns[]` array into a scaffolded declarative pattern-pack proposal at `packs/patterns/proposed/<name>.json` — never a hand-patch to core code (see docs/EXTENDING.md for the full process). Reads the unknown\'s evidence as the embedded fixture + a TODO trigger (empty `contains`, context inferred from the unknown\'s extensionPoint: overlay-open -> diff.added, value-domain -> overlay), writes the file, and prints a checklist (fill trigger -> `--lint` -> re-run graph-analyse and confirm the unknown is GONE -> add a grammar fixture test -> the `gh pr create` command to upstream it, generated with a body citing the evidence — printed only, NEVER auto-run). An unknown whose extensionPoint is `core-design` (no pack TYPE can express the fix) is DECLINED with the reason instead of scaffolded — file a core-design issue with its evidence, never invent a third pack type. Exits 0 on a successful scaffold even though the TODO trigger fails lint by design (that failure is reported IN the JSON, not as a process error).',
    args: [],
    flags: [
      { name: '--from-unknown', takesValue: true, description: '"<path to a graph-analyse --draft JSON file>#<index into its unknowns[] array>", e.g. draft.json#3.' },
      { name: '--name', takesValue: true, description: 'Kebab-case slug for the new pack (becomes packs/patterns/proposed/<name>.json and the pack\'s "name" field).' },
      { name: '--lint', takesValue: true, description: 'Re-check path (no standalone pattern-lint verb): re-run lint on an existing pack FILE (after you\'ve filled in the trigger) instead of scaffolding a new one.' },
    ],
    example: 'webnav dev pattern-propose --from-unknown draft.json#3 --name date-picker-divsoup   # then: webnav dev pattern-propose --lint packs/patterns/proposed/date-picker-divsoup.json',
  },
  {
    name: 'graph-edit',
    summary: 'Upsert a validated navigation graph into a site-node interior (creates the node if new). Accepts graph-analyse --draft output as-is, incl. a state\'s `provisional` (tri-state: omit key = keep prior, null = confirmed/clear, a string = still-provisional with that note) and an affordance\'s `scope: \'row\'` (a folded per-row repeat, e.g. one "edit" button standing for all table rows).',
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
    name: 'node-clear',
    summary: 'Wipe a site-node\'s INTERIOR (its states + edges) so the site can be RE-LEARNED from scratch through webnav. The node row itself stays. Use before re-recording a site whose map is stale/wrong — never hand-edit the DB.',
    args: [],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (host) to clear, e.g. github.com.' }],
    example: 'webnav dev node-clear --node www.saucedemo.com',
  },
  {
    name: 'node-rm',
    summary: 'Fully DELETE a site-node — its states, edges, node-edges, AND the node row itself — so a stale or empty site disappears entirely (e.g. from the dashboard). Stronger than node-clear (which keeps the row). Never hand-edit the DB.',
    args: [],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (host) to delete, e.g. pypi.org.' }],
    example: 'webnav dev node-rm --node pypi.org',
  },
  {
    name: 'export-map',
    summary: 'Emit a site\'s full map pack {node, states} as JSON (skeleton only — never credentials). The unit a hosted service publishes; pipe it wherever maps are shared.',
    args: [{ name: 'site', required: true, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [{ name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' }],
    example: 'webnav dev export-map www.saucedemo.com > saucedemo-map.json',
  },
  {
    name: 'import-map',
    summary: 'Load a map pack (the JSON `export-map` emits) into your local map, so you can `walk` a site someone else mapped WITHOUT re-learning it. Pure skeleton — set the login creds separately with `creds set`.',
    args: [{ name: 'file', required: true, description: 'Path to a map-pack JSON file. Also accepts --file.' }],
    flags: [{ name: '--file', takesValue: true, description: 'Map-pack path (alternative to the positional).' }],
    example: 'webnav dev import-map mappacks/saucedemo.mappack.json',
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
    name: 'frontier',
    summary: 'Report a map\'s UNEXPLORED FRONTIER — the declared affordances the map recorded an opener for but NEVER followed to a resolved state. This is how you know a walkthrough is COMPLETE: drive the frontier to empty (minus your hard exclusions) and the site is mapped; don\'t guess by eyeballing. Three item kinds, all from stored data (zero LLM): `dangling-target` (a navigate/reveal with no toState — opener seen, destination never captured), `unopened-panel` (a reveal whose children were never recorded), `ambiguous-action` (a mutate/input whose label does NOT match a known in-place shape — sort/refresh/pagination/toggle/close/search/… — so it MIGHT open a new surface an explorer should verify, e.g. an account/model switcher). NOT flagged: resolved navigates, reveals with children, clearly in-place mutates, and per-row/widget scope templates (already generalized). Output: {status, node, total, frontier:[{state,kind,label,reason,hint}], excluded:[…], byState:{stateId:count}}. Since the map is judgment-free, webnav does NOT know your hard "never click" list — pass it yourself with repeatable `--exclude <label>` (case-insensitive substring); matched items move to `excluded[]` (visible, off the worklist) rather than being dropped. Exit 0 = frontier empty (fully explored) · 3 = frontier non-empty (ran fine, work remains).',
    args: [{ name: 'site', required: false, description: 'Site-node id (host), e.g. www.saucedemo.com. Also accepts --node.' }],
    flags: [
      { name: '--node', takesValue: true, description: 'Site-node id (alternative to the positional).' },
      { name: '--exclude', takesValue: true, description: 'A label to treat as a hard exclusion (repeatable). Case-insensitive substring; matched frontier items go to `excluded[]` instead of the worklist. Supply your own per-site "never click" list (e.g. Admin, a destructive toggle).' },
    ],
    example: 'webnav dev frontier www.saucedemo.com --exclude Admin --exclude "Reset App State"',
  },
  {
    name: 'capture-loop',
    summary: 'Self-improving capture loop: run --explore-cmd (drives one agent exploration of --objective, recording $WEBNAV_LOOP_SESSION), then a structured review audits video-vs-steps for capture gaps; repeats until a clean audit or exits 3 with the gaps to fix.',
    args: [],
    flags: [
      { name: '--objective', takesValue: true, description: 'What the agent should explore (required).' },
      { name: '--explore-cmd', takesValue: true, description: 'Command that drives ONE round via `use session` on $WEBNAV_LOOP_SESSION (required).' },
      { name: '--max-rounds', takesValue: true, description: 'Max rounds before giving up (default 5).' },
      { name: '--model', takesValue: true, description: 'Review model (default sonnet).' },
    ],
    example: 'webnav dev capture-loop --objective "explore reports" --explore-cmd "./explore.sh" --max-rounds 3',
  },
  {
    name: 'effects',
    summary: 'Dump a record session\'s RAW action-effects (full before/after snapshots + diff + navigated) as JSON — the unabridged data `graph-analyse` only summarizes.',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id from `dev record-start`.' }],
    example: 'webnav dev effects --session map-1',
  },
  {
    name: 'record-rename',
    summary: 'Rename a recording\'s id (across the session row + its observations) and move its on-disk video/review dirs — so a session reads as what it captures (e.g. reports-list) instead of an ad-hoc id (s1final). Refuses if the target id already exists.',
    args: [],
    flags: [
      { name: '--from', takesValue: true, description: 'Current session id.' },
      { name: '--to', takesValue: true, description: 'New session id (must not already exist).' },
    ],
    example: 'webnav dev record-rename --from s1final --to reports-list',
  },
  {
    name: 'review',
    summary: 'Audit a recorded session\'s VIDEO against its captured STEPS (Sonnet over ffmpeg frames) → capture gaps: on-screen changes with no recorded step. Writes an APPROVED verdict tag on the session when zero gaps (→ graph-ready) or needs-fix with the gap list (exit 3). The per-session gate: a session should be APPROVED before you build a graph from it.',
    args: [{ name: 'session', required: false, description: 'Record session id (or pass --session).' }],
    flags: [
      { name: '--session', takesValue: true, description: 'Record session id to review.' },
      { name: '--model', takesValue: true, description: 'Review model (default sonnet).' },
      { name: '--instructions', takesValue: true, description: 'Override the audit task prose (advanced).' },
    ],
    example: 'webnav dev review --session s1v3',
  },
  {
    name: 'verify',
    summary: 'Check that the affordance element fingerprints of the state the --session browser is currently on resolve UNIQUELY against the live page. The live-page check graph-edit (offline) cannot do: matchState identifies the state, then each navigate/input affordance\'s elementFp is resolved. status done = all unique · non-unique = some collide (exit 3) · no-match = not on a known state.',
    args: [],
    flags: [
      { name: '--node', takesValue: true, description: 'Site-node id whose states to match against (e.g. www.saucedemo.com).' },
      { name: '--session', takesValue: true, description: 'A live browser session already ON the page to verify.' },
    ],
    example: 'webnav dev verify --node www.saucedemo.com --session sd1',
  },
  {
    name: 'hover-probe',
    summary: 'Reveal the HOVER / RIGHT-CLICK repertoire of the page the --session browser is currently on — the mega-menus and context menus that live in NO settled snapshot and so are otherwise omitted from the map (gap X2). An OPT-IN pass over a LIVE recording session: it snapshots the page, picks STRUCTURAL candidates (nodes with aria-haspopup, menuitems, and named interactive nodes inside a banner/navigation landmark — judgment-free, capped at --limit), hovers each, diffs what appears, and appends a reveal ActionEffect (marked hover) to the recording for any candidate that exposed new nodes. REVEAL ONLY — it never clicks anything inside a revealed menu (commit rule). --right-click switches to right-click (context menus, marked rightClick). The session MUST be recording (start it and drive it to the page first) — a non-recording session is refused, never a silent no-op. status done = something revealed · empty = nothing revealed (exit 3). Run it, then re-draft (dev graph-analyse --draft) to pick up the new reveal affordances.',
    args: [],
    flags: [
      { name: '--session', takesValue: true, description: 'A live recording session already ON the page to probe (from dev record-start, driven to the page).' },
      { name: '--limit', takesValue: true, default: '12', description: 'Max candidates to probe (default 12).' },
      { name: '--right-click', takesValue: false, description: 'Right-click (context menus) instead of hover (mega-menus). Marks the effect rightClick.' },
    ],
    example: 'webnav dev hover-probe --session sd1 --limit 8',
  },
  {
    name: 'profile-status',
    summary: 'Evidence-based "is this profile still logged in for this site?" check — call BEFORE walking/recording an authed site instead of guessing. Opens ONE headless session under --profile, loads the site\'s map homeUrl (or --url), settles the landing, and classifies it against the site\'s own map fingerprints (the oracle: matchState) — valid (landed + matched a known state) | needs-login (foreign-host wall, interstitial/bot-wall, or a declared password field — includes loginUrl) | unknown (no map yet / ambiguous landing). The session is always reaped after. Exit 0 in all three cases — needs-login is a normal, useful answer, not a failure.',
    args: [],
    flags: [
      { name: '--profile', takesValue: true, description: 'Named profile to check (shared login dir under ~/.webnav/profiles, or an absolute path).' },
      { name: '--site', takesValue: true, description: 'Site-node id (host), e.g. www.saucedemo.com — its map supplies homeUrl + the fingerprints matchState checks against.' },
      { name: '--url', takesValue: true, description: 'Override the entry url instead of the map\'s homeUrl (required if the site has no map yet).' },
    ],
    example: 'webnav dev profile-status --profile work --site www.saucedemo.com',
  },
  {
    name: 'sessions',
    summary: 'List or reap playwright-cli browser sessions. They are DAEMONIZED (survive the CLI exiting) so `use`/`walk-resume` can reattach — but a paused-and-abandoned walk or a stopped `use` exploration leaks a Chrome forever. `list` shows each session + age + whether its browser is still live; `reap` closes them.',
    args: [{ name: 'sub', required: false, description: 'list (default) | reap' }],
    flags: [
      { name: '--all', takesValue: false, description: 'reap: close EVERY session (default closes only orphans whose browser already died).' },
      { name: '--max-age-hours', takesValue: true, description: 'reap: also close LIVE sessions older than N hours (a TTL sweep).' },
    ],
    example: 'webnav dev sessions reap                    # close dead-browser orphans\nwebnav dev sessions reap --all              # close everything\nwebnav dev sessions reap --max-age-hours 6  # also close live sessions older than 6h\nwebnav dev sessions list',
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
    flags: [
      { name: '--port', takesValue: true, default: '7777', description: 'Port to bind on 127.0.0.1 (or set WEBNAV_PORT). The dashboard runs until Ctrl-C.' },
      { name: '--open', takesValue: false, description: 'Open the dashboard URL in a browser tab on start (macOS). Off by default — the URL is printed to click.' },
    ],
    example: 'webnav dev dashboard --port 7777',
  },
  {
    name: 'ingest',
    summary: 'Run a localhost receiver that turns human-recorded browser sessions into map data. Starts an HTTP server on --port (default 7778); the webnav-extension Chrome extension POSTs recorded steps to POST /ingest — they land in webnav.db as ActionEffects, identical to agent-recorded ones. Then use `dev graph-analyse --session <id> --draft`. Runs until Ctrl-C.',
    args: [],
    flags: [{ name: '--port', takesValue: true, default: '7778', description: 'Localhost port to listen on.' }],
    example: 'webnav dev ingest --port 7778',
  },
  {
    name: 'agent-serve',
    summary: 'Run the local agent server the webnav-extension sidePanel talks to. Starts an HTTP server on --port (default 7779): GET /api/agent/events streams SSE {type:turn|action|done|error|plan} events (last connection wins — opening a second panel evicts the first); POST /api/agent/goal {goal,sessionId,mode} starts a run; POST /api/agent/command-result {id,result} resolves a pending action command the server emitted; POST /api/agent/stop aborts the current run; POST /ingest-ax lands a live run as ActionEffects (same path as `dev ingest`). Runs until Ctrl-C.',
    args: [],
    flags: [
      { name: '--port', takesValue: true, default: '7779', description: 'Localhost port to listen on.' },
      { name: '--token', takesValue: true, description: 'Pin the auth token to a fixed hex string, stable across restarts (paste into the panel once). Omit to get a fresh random token every run (the old behavior).' },
    ],
    example: 'webnav dev agent-serve --port 7779 --token deadbeef1234',
  },
];

export const COMMANDS: CommandSpec[] = [...CONSUMER_COMMANDS, ...DEV_COMMANDS];
