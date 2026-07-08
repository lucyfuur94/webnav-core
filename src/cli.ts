import { topLevelHelp, commandHelp } from './cli-help.js';
import { VERSION, COMMANDS } from './cli-spec.js';
import type { BrowserOpts } from './playwright/adapter.js';
import type { RecordingsDeps } from './dashboard/server.js';
import { dbPath } from './paths.js';

export type ParsedArgs =
  | { cmd: 'help'; command?: string }
  | { cmd: 'version' }
  | { cmd: 'list' }
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
  | { cmd: 'record-live'; session: string; url: string; interval: number }
  | { cmd: 'graph-analyse'; session: string; draft: boolean }
  | { cmd: 'graph-edit'; node: string; graph: string }
  | { cmd: 'graph-show'; node: string }
  | { cmd: 'node-clear'; node: string }
  | { cmd: 'node-rm'; node: string }
  | { cmd: 'import-map'; file: string }
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
  | { cmd: 'verify'; node: string; session: string }
  | { cmd: 'sessions'; sub: string; all: boolean; maxAgeHours?: number }
  | { cmd: 'mcp' }
  | { cmd: 'dashboard'; port: number }
  | { cmd: 'ingest'; port: number }
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
  if (cmd === 'record-live') return { cmd, session: flagValue(rest, '--session') ?? '', url: flagValue(rest, '--url') ?? '', interval: Number(flagValue(rest, '--interval') ?? 500) };
  // session comes from --session, falling back to the first positional — both humans
  // and agents naturally type `graph-analyse <id> --draft`, and the flag-only parse
  // silently queried session '' and reported "empty" (live-acceptance trap).
  if (cmd === 'graph-analyse') return { cmd, session: flagValue(rest, '--session') ?? rest.find((a) => !a.startsWith('--')) ?? '', draft: rest.includes('--draft') };
  if (cmd === 'graph-edit') return { cmd, node: flagValue(rest, '--node') ?? '', graph: flagValue(rest, '--graph') ?? '' };
  if (cmd === 'graph-show') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'node-clear') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'node-rm') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'import-map') return { cmd, file: flagValue(rest, '--file') ?? rest[0] ?? '' };
  if (cmd === 'export-map') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  // outline/mermaid take the site as a positional OR --node (ergonomic: `outline <site>`).
  if (cmd === 'outline') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  if (cmd === 'mermaid') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  if (cmd === 'effects') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'verify') return { cmd, node: flagValue(rest, '--node') ?? '', session: flagValue(rest, '--session') ?? '' };
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
  if (cmd === 'ingest') return { cmd, port: Number(flagValue(rest, '--port') ?? 7778) };
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
    // "what's on this map?" — the sites webnav has a map for + their state counts.
    const { MapStore } = await import('./mapstore/store.js');
    const { listCoverage } = await import('./router/catalog.js');
    console.log(JSON.stringify(listCoverage(new MapStore(dbPath())), null, 2));
    return;
  }
  if (args.cmd === 'read') {
    const { readUrl } = await import('./router/read.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const adapter = new PlaywrightAdapter(`read-${Date.now()}`, undefined, undefined, args.browser);
    // open then snapshot WITH READINESS RETRY — a JS SPA (e.g. OrangeHRM) renders after the
    // first paint, so a bare immediate snapshot catches an unfinished shell and read wrongly
    // reports `blocked: loading`. snapshotReady waits for the page to actually render.
    const fetchSnapshot = async (u: string) => { await adapter.open(u); return adapter.snapshotReady(); };
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
  if (args.cmd === 'record-live') {
    // Human-driven recording (vs. record-start's agent-driven `use` loop): opens a headed
    // browser, then runs Task 3's poll loop until Ctrl-C or `record-stop` flips isActive off.
    // Long-lived like `ingest`/`dashboard` — does NOT print-and-exit until stopped.
    if (!args.session || !args.url) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev record-live --session <S> --url <U>' }, null, 2));
      process.exitCode = 2; return;
    }
    const { runLiveRecord } = await import('./recorder/live-record.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const store = new RecordStore(dbPath());
    store.start(args.session);
    // finally-guard: a throw anywhere below (adapter.open on a dead URL, the loop
    // itself) must not leave the record session dangling active=1 in the DB.
    try {
      const adapter = new PlaywrightAdapter(args.session); // headed by default
      await adapter.open(args.url);
      let stopped = false;
      process.on('SIGINT', () => { stopped = true; });
      process.stderr.write(`recording — click around in the browser window; stop with Ctrl-C or \`webnav dev record-stop --session ${args.session}\`\n`);
      const res = await runLiveRecord({
        adapter, store, sessionId: args.session, intervalMs: args.interval,
        log: (l) => process.stderr.write(l + '\n'), isStopped: () => stopped,
      });
      console.log(JSON.stringify({
        status: 'stopped', session: args.session, appended: res.appended,
        next: `webnav dev graph-analyse --session ${args.session} --draft`,
      }, null, 2));
      if (res.appended === 0) process.exitCode = 3;
    } finally {
      store.stop(args.session);
    }
    return;
  }
  if (args.cmd === 'graph-analyse') {
    const { RecordStore } = await import('./mapstore/record.js');
    const effects = new RecordStore(dbPath()).actionEffects(args.session);
    if (args.draft) {
      // --draft: fold the recorded walk-through into a ready, SELF-VERIFIED {node,states,edges}
      // graph-edit spec (absolute URLs, uniqueness fingerprints, resolvable edges) so learning
      // is "drive once → accept", not hand-author. The agent curates + pipes to graph-edit.
      const { draftFromEffects } = await import('./explorer/draft.js');
      const draft = draftFromEffects(effects);
      console.log(JSON.stringify({ status: draft.states.length ? 'done' : 'empty', ...draft }, null, 2));
      if (draft.states.length === 0) process.exitCode = 3;
      return;
    }
    const { analyseActionEffects } = await import('./explorer/analyse.js');
    const result = analyseActionEffects(effects);
    console.log(JSON.stringify(result, null, 2));
    if (result.sites.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'ingest') {
    // Long-lived localhost receiver (like `dashboard`/`mcp`): does NOT print-and-exit.
    // The webnav-recorder Chrome extension POSTs recorded sessions here; they land
    // in webnav.db as ActionEffects via `serveIngest` -> `ingest` (Task 2).
    const { serveIngest } = await import('./recorder/ingest.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const server = serveIngest(args.port, new RecordStore(dbPath()));
    process.stderr.write(`webnav ingest listening on http://127.0.0.1:${args.port}/ingest\n`);
    console.log(JSON.stringify({ status: 'listening', port: args.port }));
    await new Promise(() => {}); // run until killed
    return;
  }
  if (args.cmd === 'effects') {
    const { RecordStore } = await import('./mapstore/record.js');
    const effects = new RecordStore(dbPath()).actionEffects(args.session);
    console.log(JSON.stringify({ status: effects.length ? 'done' : 'empty', session: args.session, effects }, null, 2));
    if (effects.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'verify') {
    // Phase 5: check a hand-authored map's affordance fingerprints resolve UNIQUELY against
    // the live page the session is currently on. graph-edit is offline; this is the only
    // place an authored elementFp is validated against real bytes. v1 = single page (the
    // state the browser is on); multi-state drive-through is a follow-up.
    if (!args.node || !args.session) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev verify --node <id> --session <S>' }, null, 2));
      process.exitCode = 2; return;
    }
    const { MapStore } = await import('./mapstore/store.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { parseSnapshot } = await import('./playwright/snapshot.js');
    const { matchState } = await import('./explorer/fingerprint.js');
    const { resolveByFingerprint } = await import('./playwright/fingerprint.js');
    const store = new MapStore(dbPath());
    const nodes = parseSnapshot(await new PlaywrightAdapter(args.session).snapshot());
    const matched = matchState(nodes, store.statesForNode(args.node));
    if (matched.status !== 'matched') {
      console.log(JSON.stringify({ status: 'no-match', node: args.node, reason: matched.status }, null, 2));
      process.exitCode = 3; return;
    }
    const state = matched.state;
    const checks: { id: string; label: string; unique: boolean; matchedRefs: string[] }[] = [];
    const walkAffs = (affs: typeof state.affordances): void => {
      for (const a of affs) {
        if (a.elementFp && (a.kind === 'navigate' || a.kind === 'reveal' || a.kind === 'input')) {
          const ref = resolveByFingerprint(a.elementFp, nodes);
          const all = nodes.filter((n) => n.ref && n.role === a.elementFp!.role && n.name === a.elementFp!.name).map((n) => n.ref!);
          checks.push({ id: a.id, label: a.label, unique: ref !== null, matchedRefs: ref ? [ref] : all });
        }
        if (a.children) walkAffs(a.children);
      }
    };
    walkAffs(state.affordances ?? []);
    const allUnique = checks.every((c) => c.unique);
    console.log(JSON.stringify({ status: allUnique ? 'done' : 'non-unique', node: args.node, state: state.id, affordances: checks }, null, 2));
    if (!allUnique) process.exitCode = 3;
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
  if (args.cmd === 'node-clear') {
    // Wipe a node's interior so it can be re-learned through webnav (never raw sqlite).
    const { MapStore } = await import('./mapstore/store.js');
    if (!args.node) { console.log(JSON.stringify({ status: 'error', hint: 'pass --node <site-id>' })); process.exitCode = 2; return; }
    const store = new MapStore(dbPath());
    const before = store.statesForNode(args.node).length;
    store.clearNode(args.node);
    console.log(JSON.stringify({ status: before ? 'done' : 'empty', node: args.node, statesCleared: before }, null, 2));
    if (!before) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'node-rm') {
    // Fully delete a node (row + states + edges + node-edges) — never raw sqlite.
    const { MapStore } = await import('./mapstore/store.js');
    if (!args.node) { console.log(JSON.stringify({ status: 'error', hint: 'pass --node <site-id>' })); process.exitCode = 2; return; }
    const store = new MapStore(dbPath());
    const existed = store.getNode(args.node) !== null;
    const states = store.statesForNode(args.node).length;
    store.removeNode(args.node);
    console.log(JSON.stringify({ status: existed ? 'done' : 'empty', node: args.node, removed: existed, statesRemoved: states }, null, 2));
    if (!existed) process.exitCode = 3;
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
  if (args.cmd === 'import-map') {
    // Load a map pack (export-map's JSON) into the local map — import a site someone
    // else mapped, no re-learning. Skeleton only; creds are set separately.
    const { MapStore } = await import('./mapstore/store.js');
    const { importMapPack } = await import('./hosted.js');
    const { readFileSync } = await import('node:fs');
    if (!args.file) { console.log(JSON.stringify({ status: 'error', hint: 'pass a map-pack file path (or --file)' })); process.exitCode = 2; return; }
    let pack: any;
    try { pack = JSON.parse(readFileSync(args.file, 'utf8')); }
    catch (e: any) { console.log(JSON.stringify({ status: 'error', hint: `could not read/parse ${args.file}: ${e.message}` })); process.exitCode = 2; return; }
    if (!pack || !pack.node || !Array.isArray(pack.states)) {
      console.log(JSON.stringify({ status: 'error', hint: 'not a map pack — expected {node, states:[...]} (from `dev export-map`)' })); process.exitCode = 2; return;
    }
    const store = new MapStore(dbPath());
    importMapPack(store, pack);
    console.log(JSON.stringify({ status: 'done', node: pack.node.id, statesImported: pack.states.length,
      hint: `set login creds with: webnav dev creds set ${pack.node.id} username=… password=…` }, null, 2));
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
    const { RecordStore } = await import('./mapstore/record.js');
    const { runLiveRecord } = await import('./recorder/live-record.js');
    const { MODE_JS } = await import('./recorder/live.js');
    const { ReplayController, runReplay } = await import('./recorder/replay.js');
    const { draftFromEffects } = await import('./explorer/draft.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync: existsSync2 } = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const { listSessions: listPwSessions } = await import('./playwright/sessions.js');
    const store = new MapStore(dbPath());
    ensureSeeded(store);
    const creds = new CredStore();
    const port = args.port;

    // Recordings deps for the dashboard's Recordings tab — record by clicking,
    // replay to verify. ONE driven browser at a time (CLAUDE.md rule); `busy`
    // tracks it so a second open/replay while one is up gets a clear 409-style error.
    const recordStore = new RecordStore(dbPath());
    let busy: string | null = null;
    let activeAdapter: InstanceType<typeof PlaywrightAdapter> | null = null;   // for instant overlay updates
    // realtime push hub: SSE subscribers get 'sessions' | 'step' | 'replay' | 'log' pings
    const sseListeners = new Set<(t: string) => void>();
    const emit = (t: string) => { for (const f of sseListeners) f(t); };
    // dashboard log stream: everything the operator should see, timestamped + pushed
    const logBuf: { t: number; line: string }[] = [];
    const dlog = (line: string) => {
      logBuf.push({ t: Date.now(), line });
      if (logBuf.length > 500) logBuf.shift();
      process.stderr.write(line + '\n');
      emit('log');
    };
    // Session VIDEO: recording-active spans are captured as .webm takes (ground
    // truth to verify the step capture against, and a session recording artifact).
    const videosRoot = join(homedir(), '.webnav', 'recordings');
    const reviewsRoot = join(homedir(), '.webnav', 'reviews');
    const profilesRoot = join(homedir(), '.webnav', 'profiles');   // STABLE per-session browser profile
    const profileDir = (id: string) => join(profilesRoot, id.replace(/[^\w.-]/g, '_'));
    const dirSizeMb = (dir: string) => {
      // cheap recursive size; profiles are small (cookies+cache), so a sync walk is fine
      let total = 0;
      const walk = (d: string) => {
        let ents: string[] = [];
        try { ents = readdirSync(d); } catch { return; }
        for (const e of ents) {
          const fp = join(d, e);
          try { const st = statSync(fp); if (st.isDirectory()) walk(fp); else total += st.size; } catch { /* skip */ }
        }
      };
      walk(dir);
      return Math.round(total / 1e5) / 10;   // MB, 1 decimal
    };
    let reviewBusy: string | null = null;
    const { DEFAULT_INSTRUCTIONS: reviewDefaultInstructions } = await import('./recorder/review.js');
    let videoOn = false;
    const videoSync = (session: string, recording: boolean) => {
      if (recording && !videoOn && activeAdapter) {
        videoOn = true;
        void activeAdapter.videoStart().then(
          () => dlog('video: recording started'),
          () => dlog('video: START FAILED'));
      } else if (!recording && videoOn && activeAdapter) {
        videoOn = false;
        const dir = join(videosRoot, session);
        try { mkdirSync(dir, { recursive: true }); } catch { /* decoration */ }
        const file = join(dir, 'take-' + Date.now() + '.webm');
        void activeAdapter.videoStop(file).then((ok) => {
          dlog(ok ? 'video: saved ' + file : 'video: SAVE FAILED (' + file + ')');
          emit('sessions');
        });
      }
    };
    let activeCtl: InstanceType<typeof ReplayController> | null = null;
    const shotsRoot = join(homedir(), '.webnav', 'replays');
    const rec: RecordingsDeps = {
      list: () => recordStore.listSessions().map((x) => ({ ...x,
        hasProfile: existsSync2(profileDir(x.sessionId)) })),
      steps: (id: string) => recordStore.actionEffects(id).map((e) => ({ seq: e.seq,
        label: e.action?.name ?? (e.navigated ? new URL(e.toUrl).pathname : 'observe'),
        kind: e.action ? (e.navigated ? 'navigate' : e.action.role === 'textbox' ? 'input' : 'click') : (e.navigated ? 'jump' : 'observe'),
        fromUrl: e.fromUrl, toUrl: e.toUrl, value: e.action?.value, capturedAt: e.capturedAt })),
      del: (id: string) => {
        recordStore.deleteSession(id);
        emit('sessions');
        // remove the session's replay screenshots too (spec: shots die with the recording).
        // The same guard as shotPath: '.'/'..' here would rmSync ~/.webnav recursively.
        if (/^[\w.-]+$/.test(id) && id !== '.' && id !== '..') {
          try { rmSync(join(shotsRoot, id), { recursive: true, force: true }); } catch { /* decoration */ }
          try { rmSync(join(videosRoot, id), { recursive: true, force: true }); } catch { /* decoration */ }
          try { rmSync(join(reviewsRoot, id), { recursive: true, force: true }); } catch { /* decoration */ }
        }
      },
      draft: (id: string) => draftFromEffects(recordStore.actionEffects(id)),
      open: async (url: string, session: string, persistent: boolean, armedOnly?: boolean) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        busy = session;
        try {
          // persistent → a STABLE profile dir keyed by session name, so a hand-done
          // login (Cloudflare/Google/2FA) PERSISTS across window opens and into a
          // later walk. Without an explicit --profile, playwright-cli uses a random
          // temp dir per launch and the login evaporates (live finding).
          if (persistent) { try { mkdirSync(profileDir(session), { recursive: true }); } catch { /* */ } }
          const adapter = new PlaywrightAdapter(session, undefined, undefined,
            persistent ? { headed: true, persistent: true, profile: profileDir(session) } : { headed: true });
          await adapter.open(url);
          // ONE CLICK = OPEN + RECORD (live feedback: asking to press Record again
          // after "Open window" was a redundant second intent). Stop still returns
          // the window to the armed/grey state for another take.
          activeAdapter = adapter;
          if (armedOnly) {
            // armed reopen from a recording's detail: window only; Record is a
            // separate intent there (live feedback #1). Row stays visible.
            recordStore.start(session); recordStore.stop(session);
            dlog('window opened (armed) for ' + session);
          } else {
            recordStore.start(session);
            videoSync(session, true);
            dlog('recording STARTED: ' + session);
          }
          emit('sessions');
          // window liveness = the DAEMON still has a Chromium child (the daemon itself
          // outlives the window — probing it via evals is what resurrected the window).
          let daemonPid: number | undefined;
          try { daemonPid = (await listPwSessions(Date.now())).find((x) => x.name === session)?.pid; } catch { /* fallback below */ }
          const browserAlive = daemonPid === undefined ? undefined : () => {
            try { return execSync(`ps -axo ppid=,comm= | awk '$1==${daemonPid}'`, { encoding: 'utf8' })
              .toLowerCase().includes('chrom'); } catch { return true; }   // ps hiccup ≠ dead
          };
          void runLiveRecord({ adapter, store: recordStore, sessionId: session, intervalMs: 200, armed: true,
            tickExtras: { port, session },
            onEvent: emit,
            browserAlive,
            onToggle: (recording: boolean) => videoSync(session, recording),
            // fire the instant the loop ends (window closed OR external stop): stop capture,
            // save the video, and force-reap the daemon so it can't RESURRECT the window
            // (live: split-second reopen). Runs before the graceful close in finally.
            onEnd: (reason) => {
              videoSync(session, false);
              recordStore.stop(session);
              if (reason === 'closed') { try { execSync('pkill -f ' + JSON.stringify('-s=' + session)); } catch { /* already gone */ } }
              busy = null; activeAdapter = null;
              dlog('window session ended (' + reason + '): ' + session); emit('sessions');
            },
            log: dlog, isStopped: () => false })
            .catch(() => {});
          return { ok: true as const };
        } catch (e) {
          busy = null;   // final-review #1: an open() throw (session ceiling, bad URL) wedged the guard forever
          const msg = String(e);
          if (/EINVAL/.test(msg) && /\.sock/.test(msg)) {
            return { ok: false as const, error: 'session name too long — macOS caps the daemon socket path (~104 chars); use a shorter name (≤ ~14 chars is safe)' };
          }
          return { ok: false as const, error: msg };
        }
      },
      // instant overlay update: don't wait for the loop's next tick (live finding: lag)
      record: (id: string) => { recordStore.start(id); videoSync(id, true); dlog('recording STARTED: ' + id); emit('sessions'); void activeAdapter?.evalJs(MODE_JS(true)).catch(() => {}); return true; },
      stop: (id: string) => { recordStore.stop(id); videoSync(id, false); dlog('recording STOPPED: ' + id); emit('sessions'); void activeAdapter?.evalJs(MODE_JS(false)).catch(() => {}); return true; },
      // the window pill's realtime channel (POSTed directly from the page).
      // `desired` (from the pill) is IDEMPOTENT — a stale visual can't double-toggle.
      toggle: (id: string, desired?: boolean) => {
        const was = recordStore.isActive(id);
        const next = desired ?? !was;
        if (next === was) return { recording: was };
        if (next) recordStore.start(id); else recordStore.stop(id);
        videoSync(id, next);
        dlog('recording ' + (next ? 'STARTED' : 'STOPPED') + ' (pill): ' + id);
        emit('sessions');
        void activeAdapter?.evalJs(MODE_JS(next)).catch(() => {});
        return { recording: next };
      },
      videos: (id: string) => {
        if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') return [];
        try { return readdirSync(join(videosRoot, id)).filter((f) => f.endsWith('.webm')).sort(); } catch { return []; }
      },
      videoPath: (session: string, file: string) =>
        /^[\w.-]+$/.test(session) && session !== '.' && session !== '..' && /^take-\d+\.webm$/.test(file)
          ? join(videosRoot, session, file) : null,
      subscribe: (cb: (t: string) => void) => { sseListeners.add(cb); return () => sseListeners.delete(cb); },
      activeWindow: () => (busy && !busy.startsWith('replay:') ? busy : null),
      logs: () => ({ now: Date.now(), lines: logBuf.slice(-200) }),
      review: (id: string, opts?: { model?: string; instructions?: string }) => {
        if (reviewBusy) return { ok: false, error: 'a review is already running (' + reviewBusy + ')' };
        if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') return { ok: false, error: 'bad session id' };
        const model = /^[\w.-]{1,40}$/.test(opts?.model ?? '') ? opts!.model : undefined;
        const instructions = typeof opts?.instructions === 'string' && opts.instructions.trim() ? opts.instructions.slice(0, 8000) : undefined;
        // persist last-used config so the next run (and the config GET) starts from it
        try { mkdirSync(reviewsRoot, { recursive: true });
          writeFileSync(join(reviewsRoot, 'config.json'), JSON.stringify({ model: model ?? 'sonnet', instructions }, null, 2)); } catch { /* decoration */ }
        reviewBusy = id;
        emit('sessions');
        const outDir = join(reviewsRoot, id);
        void (async () => {
          const { runSessionReview } = await import('./recorder/review.js');
          const steps = recordStore.actionEffects(id).map((e) => ({
            seq: e.seq,
            kind: e.action ? (e.navigated ? 'navigate' : e.action.role === 'textbox' ? 'input' : 'click') : (e.navigated ? 'jump' : 'observe'),
            label: e.action?.name ?? e.toUrl, value: e.action?.value, capturedAt: e.capturedAt,
          }));
          await runSessionReview(id, { videosDir: join(videosRoot, id), outDir,
            steps, logs: logBuf.slice(-200), log: dlog, claudeModel: model, instructions });
        })().finally(() => { reviewBusy = null; emit('sessions'); });
        return { ok: true };
      },
      reviewReport: (id: string) => {
        if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') return null;
        try {
          const f = join(reviewsRoot, id, 'review.md');
          return { report: readFileSync(f, 'utf8'), at: statSync(f).mtimeMs };
        } catch { return null; }
      },
      reviewRunning: () => reviewBusy,
      reviewConfig: () => {
        let saved: { model?: string; instructions?: string } = {};
        try { saved = JSON.parse(readFileSync(join(reviewsRoot, 'config.json'), 'utf8')); } catch { /* defaults */ }
        // DEFAULT_INSTRUCTIONS import is dynamic-only elsewhere; inline require here is fine at runtime
        return { model: saved.model ?? 'sonnet', instructions: saved.instructions ?? reviewDefaultInstructions };
      },
      reviewFramePath: (session: string, file: string) =>
        /^[\w.-]+$/.test(session) && session !== '.' && session !== '..' && /^[\w-]+\.png$/.test(file)
          ? (readdirSync(join(reviewsRoot, session)).filter((d) => d.startsWith('frames-'))
              .map((d) => join(reviewsRoot, session, d, file)).find((f) => existsSync2(f)) ?? null)
          : null,
      profiles: () => {
        let dirs: string[] = [];
        try { dirs = readdirSync(profilesRoot); } catch { return []; }
        return dirs.filter((d) => { try { return statSync(join(profilesRoot, d)).isDirectory(); } catch { return false; } })
          .map((d) => {
            const dir = join(profilesRoot, d);
            let lastUsed = 0; try { lastUsed = statSync(dir).mtimeMs; } catch { /* */ }
            // the site = the first recorded step's host for this session (best-effort)
            let site: string | null = null;
            try { const fx = recordStore.actionEffects(d); site = fx.length ? new URL(fx[0].fromUrl).host : null; } catch { /* */ }
            return { session: d, site, sizeMb: dirSizeMb(dir), lastUsed, open: busy === d };
          }).sort((a, b) => b.lastUsed - a.lastUsed);
      },
      profileOpen: async (session: string) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        if (!/^[\w.-]+$/.test(session) || session === '.' || session === '..') return { ok: false as const, error: 'bad session id' };
        const dir = profileDir(session);
        if (!existsSync2(dir)) return { ok: false as const, error: 'no saved profile for ' + session };
        busy = session;
        // re-login window: open the profile headed at its site (or blank) so the human
        // can refresh an expired Cloudflare/2FA login. NOT recording — closes on the
        // window being closed (browserAlive), state persists back to the profile dir.
        let startUrl = 'about:blank';
        try { const fx = recordStore.actionEffects(session); if (fx.length) startUrl = new URL(fx[0].fromUrl).origin; } catch { /* */ }
        try {
          const adapter = new PlaywrightAdapter(session, undefined, undefined, { headed: true, persistent: true, profile: dir });
          activeAdapter = adapter;
          await adapter.open(startUrl);
          dlog('re-login window opened for profile ' + session + ' — log in by hand, then close the window');
          emit('sessions');
          // keep the window alive until the human closes it (ps liveness), then release
          void (async () => {
            const { listSessions: listPw } = await import('./playwright/sessions.js');
            let pid: number | undefined;
            try { pid = (await listPw(Date.now())).find((x) => x.name === session)?.pid; } catch { /* */ }
            const alive = () => { if (pid === undefined) return true; try { return execSync('ps -axo ppid=,comm= | awk \'$1==' + pid + '\'', { encoding: 'utf8' }).toLowerCase().includes('chrom'); } catch { return true; } };
            while (alive()) { await new Promise((r) => setTimeout(r, 1000)); if (busy !== session) break; }
          })().finally(() => { busy = null; activeAdapter = null; dlog('re-login window closed: ' + session); emit('sessions'); });
          return { ok: true as const };
        } catch (e) { busy = null; return { ok: false as const, error: String(e) }; }
      },
      profileDelete: (session: string) => {
        if (!/^[\w.-]+$/.test(session) || session === '.' || session === '..') return { ok: false };
        try { rmSync(profileDir(session), { recursive: true, force: true }); dlog('profile deleted (logged out): ' + session); emit('sessions'); return { ok: true }; }
        catch { return { ok: false }; }
      },
      replay: async (id: string) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        const effects = recordStore.actionEffects(id);
        if (!effects.length) return { ok: false as const, error: 'empty recording' };
        busy = 'replay:' + id;
        const site = (() => { try { return new URL(effects[0].fromUrl).host; } catch { return ''; } })();
        const ctl = new ReplayController(id, effects.map((e) => ({ seq: e.seq, label: e.action?.name ?? (e.navigated ? 'jump' : 'observe') })));
        activeCtl = ctl;
        const adapter = new PlaywrightAdapter('replay-' + id, undefined, undefined, { headed: true });
        void runReplay(effects, ctl, { adapter, creds, site, shotsDir: join(shotsRoot, id) })
          .finally(() => { busy = null; });
        return { ok: true as const };
      },
      replayState: () => activeCtl?.state ?? null,
      replayControl: (action: string, p: { value?: string; save?: boolean; fire?: boolean }) => {
        if (!activeCtl) return false;
        if (action === 'supply') return activeCtl.supply(p.value ?? '', !!p.save);
        if (action === 'confirm') return activeCtl.confirm(!!p.fire);
        return activeCtl.control(action as 'pause' | 'next' | 'resume' | 'abort');
      },
      shotPath: (session: string, file: string) =>
        // review finding: '.'/'..' pass [\w.-]+ (dots are in the class) → one-level traversal
        /^[\w.-]+$/.test(session) && session !== '.' && session !== '..' && /^step-\d+\.png$/.test(file)
          ? join(shotsRoot, session, file) : null,
    };
    startDashboard(store, creds, { port }, rec);
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
    // Live-session CEILING (prevents the browser-count explosion). First frees orphans +
    // abandoned paused-walk browsers older than 1h (the real leak — a needs-* pause leaves a
    // live daemon nothing else reaps), then refuses if still at the cap. Never breaks a walk
    // on a housekeeping error (ensureCanOpen degrades to ok).
    const { ensureCanOpen } = await import('./playwright/sessions.js');
    const staleWalks = new WalkSessionStore().staleBrowserSessions(60 * 60 * 1000);
    const gate = await ensureCanOpen(browserSession, staleWalks);
    if (!gate.ok) { console.log(JSON.stringify({ status: 'error', reason: gate.reason }, null, 2)); process.exitCode = 2; return; }
    // --profile may be a session NAME (reuse a dashboard hand-login) or an absolute
    // path. A bare name resolves to ~/.webnav/profiles/<name> — the same dir the
    // dashboard's persistent recording wrote, so a Cloudflare/2FA login done by
    // hand once carries into every walk.
    const bopts = { ...args.browser };
    if (bopts.profile) {
      const { homedir } = await import('node:os'); const { join } = await import('node:path');
      const { resolveProfile } = await import('./playwright/adapter.js');
      bopts.profile = resolveProfile(bopts.profile, join(homedir(), '.webnav', 'profiles'));
    }
    const adapter = new PlaywrightAdapter(browserSession, undefined, undefined, bopts);
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
    // Live-session ceiling. ensureCanOpen excludes args.session, so REATTACHING an existing
    // session (the common record-flow case) is never refused — only a genuinely new session
    // past the cap is. It also frees orphans + stale paused-walk browsers first.
    const { ensureCanOpen } = await import('./playwright/sessions.js');
    const { WalkSessionStore } = await import('./router/walk-session.js');
    const gate = await ensureCanOpen(args.session, new WalkSessionStore().staleBrowserSessions(60 * 60 * 1000));
    if (!gate.ok) { console.log(JSON.stringify({ status: 'error', reason: gate.reason }, null, 2)); process.exitCode = 2; return; }
    const adapter = new PlaywrightAdapter(args.session, undefined, undefined, args.browser);
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
      // Recover a DURABLE fingerprint for the clicked element from the snapshot we just
      // took (the ephemeral ref is reassigned per snapshot; role+name+near survive). This
      // is carried through graph-analyse → graph-edit so an authored map gets fingerprints
      // without hand-writing them (Phase 4).
      const { parseSnapshot } = await import('./playwright/snapshot.js');
      const { recoverFingerprint } = await import('./playwright/fingerprint.js');
      const nodes = parseSnapshot(fromSnapshot);
      const chosen = nodes.find((n) => n.ref === args.ref);
      const elementFp = recoverFingerprint(nodes, args.ref);
      const action = chosen
        ? { role: chosen.role, name: chosen.name, ref: args.ref, elementFp }
        : { role: '', name: null, ref: args.ref };
      const r = await runActionRecorded({
        sessionId: args.session, recordStore: new RecordStore(dbPath()),
        fromUrl, fromSnapshot,
        action,
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
