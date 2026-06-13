import { topLevelHelp, commandHelp } from './cli-help.js';
import { VERSION, COMMANDS } from './cli-spec.js';
import type { BrowserOpts } from './playwright/adapter.js';
import { dbPath } from './paths.js';

export type ParsedArgs =
  | { cmd: 'help'; command?: string }
  | { cmd: 'version' }
  | { cmd: 'list' }
  | { cmd: 'describe'; place: string }
  | { cmd: 'read'; url: string; raw: boolean; browser: BrowserOpts }
  | { cmd: 'search'; query: string; top: number }
  | { cmd: 'node-add'; id: string; url: string; capabilities: string[]; topics: string[] }
  | { cmd: 'edge-add'; from: string; to: string; kind: string }
  | { cmd: 'capture'; url: string; out: string }
  | { cmd: 'eval'; url: string; js: string }
  | { cmd: 'network'; url: string }
  | { cmd: 'go-back'; session: string | undefined }
  | { cmd: 'reload'; session: string | undefined }
  | { cmd: 'record-start'; session: string }
  | { cmd: 'record-stop'; session: string }
  | { cmd: 'graph-analyse'; session: string }
  | { cmd: 'graph-edit'; node: string; graph: string }
  | { cmd: 'graph-show'; node: string }
  | { cmd: 'export-map'; node: string }
  | { cmd: 'outline'; node: string }
  | { cmd: 'mermaid'; node: string }
  | { cmd: 'navigate'; url: string; session: string; browser: BrowserOpts }
  | { cmd: 'snapshot'; session: string }
  | { cmd: 'click'; ref: string; session: string }
  | { cmd: 'type'; ref: string; text: string; session: string }
  | { cmd: 'walk'; start: string; goal: string; inputs: Record<string, string>; browser: BrowserOpts; hosted: boolean }
  | { cmd: 'walk-resume'; session: string; ref?: string; classify?: string; inputs: Record<string, string> }
  | { cmd: 'login'; key: string }
  | { cmd: 'creds'; sub: string; site?: string; key?: string; values: Record<string, string> }
  | { cmd: 'effects'; session: string }
  | { cmd: 'sessions'; sub: string; all: boolean; maxAgeHours?: number }
  | { cmd: 'mcp' }
  | { cmd: 'dashboard'; port: number }
  | { cmd: 'dev-help' }
  | { cmd: 'use-help' }
  | { cmd: 'dev'; devCmd: string | undefined; devRest: string[] };

// Split a comma-separated flag value into an array; absent flag → empty array.
function listFlag(args: string[], name: string): string[] {
  const v = flagValue(args, name);
  return v === undefined ? [] : v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

// Pull the value following a flag (or one of its aliases) out of an arg list.
function flagValue(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i !== -1) return args[i + 1];
  }
  return undefined;
}

// Browser launch flags shared by the verbs that open a browser (read / navigate /
// walk). Default is HEADED — a real visible window — so every run is watchable;
// pass `--headless` to opt out (CI / gated live tests). `--headed` is still
// accepted as an explicit no-op for back-compat. `--persistent` / `--profile
// <dir>` reuse a logged-in profile; `--browser chrome|firefox|webkit|msedge`
// picks the engine.
function browserOpts(args: string[]): BrowserOpts {
  const has = (f: string) => args.includes(f);
  const o: BrowserOpts = {};
  o.headed = !has('--headless');   // headed by default; --headless opts out
  if (has('--persistent')) o.persistent = true;
  const profile = flagValue(args, '--profile');
  if (profile) { o.profile = profile; o.persistent = true; }   // a profile implies persistent
  const browser = flagValue(args, '--browser');
  if (browser) o.browser = browser;
  return o;
}

// Collect repeated `--input slot=value` flags into a map. Runtime-only values
// (credentials, form fields) — the walk forwards slot NAMES, never stores values.
function inputFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      const [k, ...rest] = args[i + 1].split('=');
      out[k] = rest.join('='); i++;
    }
  }
  return out;
}

const KNOWN_VERBS = new Set([...COMMANDS.map((c) => c.name), 'read']);

export function parseArgs(argv: string[]): ParsedArgs {
  // Global help/version and empty argv are checked BEFORE the verb switch.
  if (argv.length === 0) return { cmd: 'help' };
  const first = argv[0];
  if (first === '--help' || first === '-h') return { cmd: 'help' };
  if (first === '--version' || first === '-V') return { cmd: 'version' };

  const [cmd, ...rest] = argv;

  // Per-command trailing help: `webnav <verb> --help` → help for that verb.
  // Checked after identifying the verb so `recall --help` doesn't try to run.
  if (KNOWN_VERBS.has(cmd) && (rest.includes('--help') || rest.includes('-h'))) {
    return { cmd: 'help', command: cmd };
  }

  if (cmd === 'list') return { cmd };
  if (cmd === 'describe') return { cmd, place: rest[0] };
  if (cmd === 'read') {
    // First non-flag positional is the URL, so `read --raw <url>` and
    // `read <url> --raw` both work (agents write the flag in either order).
    const url = rest.find((a) => !a.startsWith('--')) ?? '';
    return { cmd, url, raw: rest.includes('--raw'), browser: browserOpts(rest) };
  }
  if (cmd === 'capture') return { cmd, url: rest[0], out: rest[1] };
  if (cmd === 'use') {
    const sub = rest[0];
    if (!sub || sub === '--help' || sub === '-h') return { cmd: 'use-help' };
    return parseArgs([sub, ...rest.slice(1)]);
  }
  if (cmd === 'dev') {
    const sub = rest[0];
    if (!sub || sub === '--help' || sub === '-h') return { cmd: 'dev-help' };
    return parseArgs([sub, ...rest.slice(1)]);
  }
  if (cmd === 'search') {
    const query = rest[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 3;
    return { cmd, query, top };
  }
  if (cmd === 'node-add') {
    return {
      cmd, id: rest[0], url: flagValue(rest, '--url') ?? '',
      capabilities: listFlag(rest, '--capabilities'),
      topics: listFlag(rest, '--topics'),
    };
  }
  if (cmd === 'edge-add') {
    return { cmd, from: rest[0], to: rest[1], kind: flagValue(rest, '--kind') ?? 'capability' };
  }
  if (cmd === 'eval') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, url: pos[0], js: pos[1] };
  }
  if (cmd === 'network') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, url: pos[0] };
  }
  if (cmd === 'go-back') return { cmd, session: flagValue(rest, '--session') };
  if (cmd === 'reload') return { cmd, session: flagValue(rest, '--session') };
  if (cmd === 'record-start') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'record-stop') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'graph-analyse') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'graph-edit') return { cmd, node: flagValue(rest, '--node') ?? '', graph: flagValue(rest, '--graph') ?? '' };
  if (cmd === 'graph-show') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'export-map') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  // outline/mermaid take the site as a positional OR --node (ergonomic: `outline <site>`).
  if (cmd === 'outline') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  if (cmd === 'mermaid') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  if (cmd === 'effects') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'sessions') {
    const maxAge = flagValue(rest, '--max-age-hours');
    return { cmd, sub: rest.find((a) => !a.startsWith('--')) ?? 'list',
      all: rest.includes('--all'), maxAgeHours: maxAge ? Number(maxAge) : undefined };
  }
  if (cmd === 'mcp') return { cmd };
  if (cmd === 'dashboard') {
    const portFlag = flagValue(rest, '--port');
    const port = Number(portFlag ?? process.env.WEBNAV_PORT ?? 7777);
    return { cmd, port };
  }
  if (cmd === 'walk') {
    return { cmd, start: flagValue(rest, '--start') ?? '', goal: flagValue(rest, '--goal') ?? '',
      inputs: inputFlags(rest), browser: browserOpts(rest), hosted: rest.includes('--hosted') };
  }
  if (cmd === 'walk-resume') {
    return { cmd, session: rest.find((a) => !a.startsWith('--')) ?? '',
      ref: flagValue(rest, '--ref'), classify: flagValue(rest, '--classify'),
      inputs: inputFlags(rest) };
  }
  if (cmd === 'login') {
    return { cmd, key: rest.find((a) => !a.startsWith('--')) ?? '' };
  }
  if (cmd === 'creds') {
    // creds set <site> key=value... | creds list | creds rm <site> [key]
    const sub = rest[0] ?? '';
    const pos = rest.slice(1).filter((a) => !a.startsWith('--') && !a.includes('='));
    const values: Record<string, string> = {};
    for (const a of rest.slice(1)) {
      if (a.includes('=') && !a.startsWith('--')) { const [k, ...v] = a.split('='); values[k] = v.join('='); }
    }
    return { cmd, sub, site: pos[0], key: pos[1], values };
  }
  if (cmd === 'navigate') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, url: pos[0] ?? '', session: flagValue(rest, '--session') ?? '', browser: browserOpts(rest) };
  }
  if (cmd === 'snapshot') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'click') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, ref: pos[0] ?? '', session: flagValue(rest, '--session') ?? '' };
  }
  if (cmd === 'type') {
    const sessionVal = flagValue(rest, '--session');
    const pos = rest.filter((a) => !a.startsWith('--') && a !== sessionVal);
    return { cmd, ref: pos[0] ?? '', text: pos[1] ?? '', session: sessionVal ?? '' };
  }
  throw new Error(`unknown command: ${cmd}\nRun \`webnav --help\` to see available commands.`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  // --json is a global output-mode flag detected directly in main() rather than
  // threaded through the ParsedArgs union (which would complicate every variant).
  // Under --json, ONLY pure JSON is written to stdout; all diagnostics → stderr.
  const json = rawArgs.includes('--json');
  const args = parseArgs(rawArgs);

  if (args.cmd === 'help') {
    // Help is informational: pure stdout, exit 0.
    console.log(args.command ? commandHelp(args.command) : topLevelHelp());
    return;
  }
  if (args.cmd === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.cmd === 'list') {
    // "what's on this map?" — known sites, places, goals. No browser needed.
    const { listCoverage } = await import('./router/catalog.js');
    console.log(JSON.stringify(listCoverage(), null, 2));
    return;
  }
  if (args.cmd === 'describe') {
    // "what's at A / what can I do here?" — affordances + address. No browser.
    const { describePlace } = await import('./router/catalog.js');
    console.log(JSON.stringify(describePlace(args.place), null, 2));
    return;
  }
  if (args.cmd === 'read') {
    const { readUrl } = await import('./router/read.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const adapter = new PlaywrightAdapter(`read-${Date.now()}`, undefined, undefined, args.browser);
    const fetchSnapshot = async (u: string) => { await adapter.open(u); return adapter.snapshot(); };
    const r = await readUrl(args.url, fetchSnapshot, { raw: args.raw });
    await adapter.close().catch(() => {});
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== 'done') process.exitCode = 3;
    return;
  }
  if (args.cmd === 'use-help') {
    console.log(topLevelHelp());
    return;
  }
  if (args.cmd === 'dev-help') {
    const { devHelp } = await import('./cli-help.js');
    console.log(devHelp());
    return;
  }
  if (args.cmd === 'capture') {
    const { capture } = await import('./playwright/capture.js');
    await capture(args.url, args.out);
    // Under --json, emit a clean JSON receipt instead of human prose so stdout
    // stays pure JSON. Otherwise the human-friendly progress line goes to stderr.
    if (json) {
      console.log(JSON.stringify({ captured: args.url, out: args.out }));
    } else {
      console.error(`captured ${args.url} -> ${args.out}`);
    }
    return;
  }
  if (args.cmd === 'search') {
    // search: open-web search — search engine → top-N results → visit + extract
    // answer-evidence. Prints a SearchGatherResult JSON for the calling agent.
    const { runSearchLive } = await import('./router/search-live.js');
    const response = await runSearchLive(args.query, args.top);
    console.log(JSON.stringify(response, null, 2));
    // "ran fine but found nothing / blocked" → exit 3 so an agent's shell can
    // distinguish a clean empty result from a crash.
    if (isEmptyOrFailed(response)) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'node-add') {
    // node-add: teach webnav a new site (persisted; the viz UI reads the same store).
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { addNode } = await import('./graph/teach.js');
    const store = new MapStore();
    ensureSeeded(store);
    const node = addNode(store, {
      id: args.id, homeUrl: args.url, capabilities: args.capabilities, topics: args.topics,
    });
    console.log(JSON.stringify(node, null, 2));
    return;
  }
  if (args.cmd === 'edge-add') {
    // edge-add: teach webnav a relationship between two KNOWN sites.
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { addEdge } = await import('./graph/teach.js');
    const store = new MapStore();
    ensureSeeded(store);
    const result = addEdge(store, { from: args.from, to: args.to, kind: args.kind as any });
    console.log(JSON.stringify(result, null, 2));
    // "ran fine but couldn't" — an edge to an unknown node → exit 3, the same
    // code search/recall use for a clean-but-unsatisfiable result.
    if (result.status === 'unknown-node') process.exitCode = 3;
    return;
  }
  if (args.cmd === 'eval') {
    const { runEval } = await import('./router/browse.js');
    const r = await runEval(args.url, args.js);
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== 'done') process.exitCode = 3;
    return;
  }
  if (args.cmd === 'network') {
    const { runNetwork } = await import('./router/browse.js');
    const r = await runNetwork(args.url);
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== 'done') process.exitCode = 3;
    return;
  }
  if (args.cmd === 'go-back' || args.cmd === 'reload') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    // These only make sense against an EXISTING session the agent has been
    // driving (a fresh session has no page to go back to). --session names it;
    // default 'webnav-nav' is the convenience session for a quick standalone step.
    const adapter = new PlaywrightAdapter(args.session ?? 'webnav-nav');
    try {
      const out = args.cmd === 'go-back' ? await adapter.goBack() : await adapter.reload();
      console.log(JSON.stringify({ status: 'done', action: args.cmd, out: out.trim() }, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', action: args.cmd, reason: String(e) }, null, 2));
      process.exitCode = 3;
    }
    return;
  }
  if (args.cmd === 'record-start') {
    const { RecordStore } = await import('./mapstore/record.js');
    const rec = new RecordStore(dbPath());
    const session = args.session || `map-${Date.now()}`;
    rec.start(session);
    console.log(JSON.stringify({ status: 'recording', session }, null, 2));
    return;
  }
  if (args.cmd === 'record-stop') {
    const { RecordStore } = await import('./mapstore/record.js');
    new RecordStore(dbPath()).stop(args.session);
    console.log(JSON.stringify({ status: 'stopped', session: args.session }, null, 2));
    return;
  }
  if (args.cmd === 'graph-analyse') {
    const { RecordStore } = await import('./mapstore/record.js');
    const { analyseActionEffects } = await import('./explorer/analyse.js');
    const result = analyseActionEffects(new RecordStore(dbPath()).actionEffects(args.session));
    console.log(JSON.stringify(result, null, 2));
    if (result.sites.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'effects') {
    const { RecordStore } = await import('./mapstore/record.js');
    const effects = new RecordStore(dbPath()).actionEffects(args.session);
    console.log(JSON.stringify({ status: effects.length ? 'done' : 'empty', session: args.session, effects }, null, 2));
    if (effects.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'sessions') {
    const { listSessions, reapSessions } = await import('./playwright/sessions.js');
    const now = Date.now();
    if (args.sub === 'reap') {
      const maxAgeMs = args.maxAgeHours !== undefined ? args.maxAgeHours * 3600_000 : undefined;
      const closed = await reapSessions(now, { all: args.all, maxAgeMs });
      console.log(JSON.stringify({ status: closed.length ? 'done' : 'empty', reaped: closed }, null, 2));
      if (closed.length === 0) process.exitCode = 3;
      return;
    }
    // default: list
    const sessions = (await listSessions(now)).map((s) => ({
      name: s.name, live: s.live,
      ageHours: s.ageMs === Infinity ? null : Math.round(s.ageMs / 3600_000 * 10) / 10,
    }));
    console.log(JSON.stringify({ status: sessions.length ? 'done' : 'empty', sessions }, null, 2));
    if (sessions.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'mcp') {
    // Server mode: stdout carries JSON-RPC (the MCP stdio transport) until
    // stdin closes — the documented exception to one-JSON-object-stdout.
    const { startMcpServer } = await import('./mcp/server.js');
    await startMcpServer();
    return;
  }
  if (args.cmd === 'graph-edit') {
    const { MapStore } = await import('./mapstore/store.js');
    const { editGraph } = await import('./graph/edit.js');
    const store = new MapStore(dbPath());
    const graph = JSON.parse(args.graph);
    console.log(JSON.stringify(editGraph(store, args.node, graph), null, 2));
    return;
  }
  if (args.cmd === 'graph-show') {
    const { MapStore } = await import('./mapstore/store.js');
    const { showInterior } = await import('./graph/show.js');
    console.log(JSON.stringify(showInterior(new MapStore(dbPath()), args.node), null, 2));
    return;
  }
  if (args.cmd === 'export-map') {
    // Emit a site's full MAP PACK { node, states } as JSON — the unit a hosted
    // service publishes/imports. Skeleton only; credentials are never in the map.
    const { MapStore } = await import('./mapstore/store.js');
    const store = new MapStore(dbPath());
    const node = store.getNode(args.node);
    const states = store.statesForNode(args.node);
    if (!node || states.length === 0) {
      console.log(JSON.stringify({ status: 'empty', node: args.node, hint: 'no map for this site in the local db — build/seed it first' }, null, 2));
      process.exitCode = 3; return;
    }
    console.log(JSON.stringify({ node, states }, null, 2));
    return;
  }
  if (args.cmd === 'outline' || args.cmd === 'mermaid') {
    // Human-scannable completeness views of a site's interior (no UI needed).
    // Per the CLI contract, the text view is carried as a `text` field on the
    // JSON stdout object (never bare); the human reads `text`, the coverage
    // summary (counts / unexplored / dead-ends / orphans) rides alongside.
    const { MapStore } = await import('./mapstore/store.js');
    const { analyseCoverage, toOutline, toMermaid } = await import('./graph/coverage.js');
    const store = new MapStore(dbPath());
    const states = store.statesForNode(args.node);
    if (!states.length) {
      console.log(JSON.stringify({ status: 'empty', node: args.node,
        hint: `no interior captured for "${args.node}" — map it with the record/teach flow` }, null, 2));
      process.exitCode = 3;
      return;
    }
    const coverage = analyseCoverage(args.node, states);
    const text = args.cmd === 'outline' ? toOutline(args.node, states) : toMermaid(args.node, states);
    console.log(JSON.stringify({ status: 'ok', node: args.node, coverage, text }, null, 2));
    return;
  }
  if (args.cmd === 'creds') {
    // Local credential store (~/.webnav/credentials.json, chmod 600). Values are
    // NEVER printed (list shows key NAMES only) and never stored in the map.
    const { CredStore, credsPath } = await import('./creds.js');
    const cs = new CredStore();
    if (args.sub === 'set') {
      if (!args.site || Object.keys(args.values).length === 0) {
        console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav creds set <site> key=value [key=value...]' }, null, 2));
        process.exitCode = 2; return;
      }
      const keys = cs.set(args.site, args.values);
      console.log(JSON.stringify({ status: 'ok', site: args.site, keys, file: credsPath() }, null, 2));
      return;
    }
    if (args.sub === 'list') {
      console.log(JSON.stringify({ status: 'ok', sites: cs.list(), file: credsPath() }, null, 2));
      return;
    }
    if (args.sub === 'rm') {
      if (!args.site) { console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav creds rm <site> [key]' }, null, 2)); process.exitCode = 2; return; }
      const removed = cs.remove(args.site, args.key);
      console.log(JSON.stringify({ status: removed ? 'ok' : 'empty', site: args.site, key: args.key, removed }, null, 2));
      if (!removed) process.exitCode = 3;
      return;
    }
    console.log(JSON.stringify({ status: 'error', hint: 'webnav creds set|list|rm' }, null, 2));
    process.exitCode = 2; return;
  }
  if (args.cmd === 'dashboard') {
    // Long-lived LOCAL operator UI (not a one-shot JSON verb): start the server,
    // print the URL to stderr (keeps stdout clean per CLI rules), auto-open the
    // browser, then stay alive until Ctrl-C. Reads ./webnav.db + the creds file.
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { CredStore } = await import('./creds.js');
    const { startDashboard } = await import('./dashboard/server.js');
    const store = new MapStore(dbPath());
    ensureSeeded(store);
    const creds = new CredStore();
    const port = args.port;
    startDashboard(store, creds, { port });
    const url = `http://127.0.0.1:${port}`;
    process.stderr.write(`webnav dashboard running at ${url}\n(reads ./webnav.db + ${process.env.WEBNAV_CREDS ?? '~/.webnav/credentials.json'}; Ctrl-C to stop)\n`);
    // Best-effort auto-open the default browser (macOS `open`; swallow errors).
    if (process.platform === 'darwin') {
      const { exec } = await import('node:child_process');
      exec(`open ${url}`, () => { /* ignore — the URL is printed regardless */ });
    }
    // Keep the process alive (the server holds the event loop; nothing else to do).
    return;
  }
  if (args.cmd === 'login') {
    // Save the hosted-route API key to ~/.webnav/config.json. This file holds ONLY
    // the service key — never site credentials (those stay in credentials.json).
    const { saveConfig } = await import('./hosted.js');
    const { configPath } = await import('./paths.js');
    if (!args.key) { console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav login <api-key>' }, null, 2)); process.exitCode = 2; return; }
    saveConfig({ apiKey: args.key });
    console.log(JSON.stringify({ status: 'ok', saved: configPath(), note: 'hosted route enabled — use `webnav walk --hosted ...`' }, null, 2));
    return;
  }
  if (args.cmd === 'walk') {
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { findPath } = await import('./router/path.js');
    const { walkRoute } = await import('./router/walk.js');
    const { WalkSessionStore } = await import('./router/walk-session.js');
    const { makeLiveWalkBrowser } = await import('./router/walk-live.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const store = new MapStore();
    if (args.hosted) {
      // HOSTED ROUTE: fetch the site's map LIVE from the service and import it,
      // instead of using the local seed. The site id is the start state's prefix
      // (e.g. www.saucedemo.com:login -> www.saucedemo.com). Credentials are still
      // loaded LOCALLY below (CredStore) — the hosted route never sees them.
      const site = args.start.includes(':') ? args.start.slice(0, args.start.lastIndexOf(':')) : args.start;
      try {
        const { fetchHostedMap, importMapPack } = await import('./hosted.js');
        const pack = await fetchHostedMap(site);
        importMapPack(store, pack);
      } catch (e) {
        console.log(JSON.stringify({ status: 'failed', reason: String((e as Error).message) }, null, 2));
        process.exitCode = 2; return;
      }
    } else {
      ensureSeeded(store);
    }
    if (!store.getState(args.start)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.start }, null, 2)); process.exitCode = 2; return; }
    if (!store.getState(args.goal)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.goal }, null, 2)); process.exitCode = 2; return; }
    const path = findPath(store, args.start, args.goal);
    if (!path) { console.log(JSON.stringify({ status: 'failed', reason: 'no route from ' + args.start + ' to ' + args.goal }, null, 2)); process.exitCode = 3; return; }
    const browserSession = 'w-' + Date.now();
    const adapter = new PlaywrightAdapter(browserSession, undefined, undefined, args.browser);
    // Opt-in background housekeeping (WEBNAV_SESSION_TTL_HOURS) — reap stale sessions,
    // never this fresh walk session. Fire-and-forget; never breaks the walk.
    const { maybeTtlSweep } = await import('./playwright/sessions.js');
    await maybeTtlSweep(browserSession);
    const startState = store.getState(args.start)!;
    await adapter.open(startState.urlPattern || 'about:blank');
    // Inputs = stored creds for this site (if any) overlaid with any --input flags
    // (flags win). Lets `walk` run without re-typing credentials each time, while
    // a one-off --input still overrides. Creds live in ~/.webnav/credentials.json,
    // never in the map.
    const { CredStore } = await import('./creds.js');
    const siteCreds = startState.nodeId ? new CredStore().get(startState.nodeId) : {};
    const inputs = { ...siteCreds, ...args.inputs };
    const browser = makeLiveWalkBrowser(adapter, inputs);
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + args.goal, startStateId: args.start, goalStateId: args.goal, store, states, browser, path });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      const sessions = new WalkSessionStore();
      const id = sessions.create({ startState: args.start, goalState: args.goal, path, browserSession });
      // pos points at the state the walk paused ON, so resume restarts there.
      const pausedAt = (res as any).at;
      if (typeof pausedAt === 'number') sessions.advance(id, pausedAt);
      // Expose browserSession so the agent can act on the LIVE paused browser
      // (e.g. fire an in-page affordance) via `use <verb> --session <browserSession>`
      // before calling walk-resume.
      console.log(JSON.stringify({ ...res, session: id, browserSession }, null, 2));
    } else {
      await adapter.close().catch(() => {});
      console.log(JSON.stringify(res, null, 2));
      if (res.status === 'failed') process.exitCode = 3;
    }
    return;
  }
  if (args.cmd === 'walk-resume') {
    const { MapStore } = await import('./mapstore/store.js');
    const { walkRoute } = await import('./router/walk.js');
    const { WalkSessionStore } = await import('./router/walk-session.js');
    const { makeLiveWalkBrowser } = await import('./router/walk-live.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const store = new MapStore();
    const sessions = new WalkSessionStore();
    const w = sessions.load(args.session);
    if (!w) { console.log(JSON.stringify({ status: 'failed', reason: 'no active walk-session ' + args.session }, null, 2)); process.exitCode = 2; return; }
    const answer = args.ref ? { kind: 'ref' as const, ref: args.ref }
      : args.classify ? { kind: 'classify' as const, verdict: args.classify as 'safe' | 'commit' }
      : undefined;
    if (!answer) { console.log(JSON.stringify({ status: 'failed', reason: 'supply --ref or --classify' }, null, 2)); process.exitCode = 2; return; }
    const resumeFrom = w.path[w.pos] ?? w.startState;
    const adapter = new PlaywrightAdapter(w.browserSession);   // reattach the live browser
    const startState = store.getState(resumeFrom) ?? store.getState(w.startState)!;
    // Rebuild the SAME stored creds the original `walk` used, so input steps
    // encountered AFTER the pause (e.g. checkout's firstName/lastName/zip) still
    // auto-fill. Keying is by node, so it covers any input step on the route, not
    // just login. Without this the resume hits unfillable fields and fails to
    // resolve them — the bug that forced a `use` fallback.
    // One-off `--input` values are runtime-only (never persisted in the walk
    // session), so the agent re-supplies them here; flags win over stored creds,
    // same overlay as `walk`.
    const { CredStore } = await import('./creds.js');
    const siteCreds = startState.nodeId ? new CredStore().get(startState.nodeId) : {};
    const inputs = { ...siteCreds, ...args.inputs };
    const browser = makeLiveWalkBrowser(adapter, inputs);
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + w.goalState, startStateId: resumeFrom, goalStateId: w.goalState, store, states, browser, path: w.path, answer });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      // walkRoute's `at` is RELATIVE to resumeFrom (it starts each call at 0), but
      // the session `pos` is ABSOLUTE over the full path. resumeFrom sits at w.pos,
      // so absolute = w.pos + at. A single resume can traverse several states before
      // halting, so this keeps the session synced (the desync bug that restarted the
      // next resume at the wrong step).
      const relAt = (res as any).at;
      const absPos = typeof relAt === 'number' ? w.pos + relAt : w.pos + 1;
      sessions.advance(args.session, absPos);
      console.log(JSON.stringify({ ...res, session: args.session, browserSession: w.browserSession }, null, 2));
    } else {
      sessions.close(args.session);
      await adapter.close().catch(() => {});
      console.log(JSON.stringify(res, null, 2));
    }
    return;
  }
  if (args.cmd === 'navigate') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const adapter = new PlaywrightAdapter(args.session, undefined, undefined, args.browser);
    // Opt-in background housekeeping (WEBNAV_SESSION_TTL_HOURS): reap orphan/old sessions,
    // never this one. Fire-and-forget — awaited only so it can't outlive the process.
    const { maybeTtlSweep } = await import('./playwright/sessions.js');
    await maybeTtlSweep(args.session);
    try {
      // `open` creates the session if new AND navigates; it also works to
      // re-navigate an existing session (whereas `goto` requires the session to
      // already exist, which fails on the first navigate of a fresh session).
      await adapter.open(args.url);
      const toSnapshot = await adapter.snapshot();
      const toUrl = await adapter.currentUrl();
      const rec = new RecordStore(dbPath());
      let recorded = false;
      if (rec.isActive(args.session)) {
        const { diffSnapshots } = await import('./explorer/diff.js');
        const { parseSnapshot } = await import('./playwright/snapshot.js');
        rec.appendActionEffect(args.session, {
          fromUrl: args.url, fromSnapshot: '', action: null,
          toUrl, toSnapshot, navigated: true,
          diff: diffSnapshots([], parseSnapshot(toSnapshot)),
        });
        recorded = true;
      }
      console.log(JSON.stringify({ status: 'done', url: toUrl, recorded }, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: String(e) }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
  if (args.cmd === 'snapshot') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const adapter = new PlaywrightAdapter(args.session);
    try {
      // Uniform JSON: every verb's stdout is structured. The page YAML (which the
      // agent reads for element refs) is carried as the `snapshot` field.
      const yaml = await adapter.snapshot();
      console.log(JSON.stringify({ status: 'done', snapshot: yaml }, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: 'no live page for session ' + args.session + ' — run `use navigate` first' }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
  if (args.cmd === 'click' || args.cmd === 'type') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const { runActionRecorded } = await import('./router/browse.js');
    const adapter = new PlaywrightAdapter(args.session);
    try {
      const fromSnapshot = await adapter.snapshot();
      const fromUrl = await adapter.currentUrl();
      const r = await runActionRecorded({
        sessionId: args.session, recordStore: new RecordStore(dbPath()),
        fromUrl, fromSnapshot,
        action: { role: '', name: null, ref: args.ref },
        text: args.cmd === 'type' ? args.text : undefined,
        adapter: adapter as any,
      });
      console.log(JSON.stringify(r, null, 2));
      if (r.status === 'failed') process.exitCode = 2;
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: String(e) }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
}

// A result that "ran fine but found nothing/blocked/failed" → exit code 3.
function isEmptyOrFailed(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const r = response as Record<string, unknown>;
  if (r.status === 'failed') return true;
  // search: zero results gathered.
  if (Array.isArray(r.results) && r.results.length === 0) return true;
  if (Array.isArray(r.evidence) && r.evidence.length === 0) return true;
  return false;
}

// Only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Thrown errors (bad args, unknown verb, crash) → stderr + exit code 2.
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
