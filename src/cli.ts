import { topLevelHelp, commandHelp } from './cli-help.js';
import { VERSION, COMMANDS } from './cli-spec.js';

export type ParsedArgs =
  | { cmd: 'help'; command?: string }
  | { cmd: 'version' }
  | { cmd: 'list' }
  | { cmd: 'describe'; place: string }
  | { cmd: 'locate'; place: string }
  | { cmd: 'read'; url: string; raw: boolean }
  | { cmd: 'list-goals' }
  | { cmd: 'recall'; goal: string; query: string; top: number }
  | { cmd: 'search'; query: string; top: number }
  | { cmd: 'route'; request: string; capability?: string }
  | { cmd: 'hop'; url: string; toCluster?: string; toNode?: string }
  | { cmd: 'graph' }
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
  | { cmd: 'navigate'; url: string; session: string }
  | { cmd: 'snapshot'; session: string }
  | { cmd: 'click'; ref: string; session: string }
  | { cmd: 'type'; ref: string; text: string; session: string }
  | { cmd: 'walk'; start: string; goal: string; inputs: Record<string, string> }
  | { cmd: 'walk-resume'; session: string; ref?: string; classify?: string }
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

const KNOWN_VERBS = new Set([...COMMANDS.map((c) => c.name), 'list-goals', 'read']);

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
  if (cmd === 'locate') return { cmd, place: rest[0] };
  if (cmd === 'read') {
    // First non-flag positional is the URL, so `read --raw <url>` and
    // `read <url> --raw` both work (agents write the flag in either order).
    const url = rest.find((a) => !a.startsWith('--')) ?? '';
    return { cmd, url, raw: rest.includes('--raw') };
  }
  if (cmd === 'list-goals') return { cmd };
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
  if (cmd === 'recall') {
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 10;
    // Positionals only: drop --flags AND the value immediately after --top
    // (otherwise `recall x --top 5` mis-reads "5" as the query).
    const pos: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--top') { i++; continue; }   // skip flag + its value
      if (rest[i].startsWith('--')) continue;        // skip any other flag
      pos.push(rest[i]);
    }
    const hasGoal = pos.length >= 2;
    const goal = hasGoal ? pos[0] : 'github-repos';
    const query = hasGoal ? pos[1] : pos[0];
    return { cmd, goal, query, top };
  }
  if (cmd === 'search') {
    const query = rest[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 3;
    return { cmd, query, top };
  }
  if (cmd === 'route') {
    return { cmd, request: rest[0], capability: flagValue(rest, '--capability', '--cap') };
  }
  if (cmd === 'hop') {
    return {
      cmd, url: rest[0],
      toCluster: flagValue(rest, '--to-cluster'),
      toNode: flagValue(rest, '--to-node'),
    };
  }
  if (cmd === 'graph') return { cmd };
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
  if (cmd === 'walk') {
    return { cmd, start: flagValue(rest, '--start') ?? '', goal: flagValue(rest, '--goal') ?? '',
      inputs: inputFlags(rest) };
  }
  if (cmd === 'walk-resume') {
    return { cmd, session: rest.find((a) => !a.startsWith('--')) ?? '',
      ref: flagValue(rest, '--ref'), classify: flagValue(rest, '--classify') };
  }
  if (cmd === 'navigate') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, url: pos[0] ?? '', session: flagValue(rest, '--session') ?? '' };
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
  if (args.cmd === 'locate') {
    // "where is A?" — return the coordinate WITHOUT navigating. No browser needed.
    const { locate } = await import('./router/locate.js');
    console.log(JSON.stringify(locate(args.place), null, 2));
    return;
  }
  if (args.cmd === 'read') {
    const { readUrl } = await import('./router/read.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const adapter = new PlaywrightAdapter(`read-${Date.now()}`);
    const fetchSnapshot = async (u: string) => { await adapter.open(u); return adapter.snapshot(); };
    const r = await readUrl(args.url, fetchSnapshot, { raw: args.raw });
    await adapter.close().catch(() => {});
    console.log(JSON.stringify(r, null, 2));
    if (r.status !== 'done') process.exitCode = 3;
    return;
  }
  if (args.cmd === 'list-goals') {
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    const goals = store.allGoals().map((g) => ({ id: g.name, site: g.site,
      signals: Object.values(g.surface).flat() }));
    console.log(JSON.stringify(goals, null, 2));
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
  if (args.cmd === 'route') {
    // route: ask the graph which node(s) serve a request. Pure structural query
    // over the seeded internet graph — no browser. Seed on first use.
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { route } = await import('./graph/route.js');
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    console.log(JSON.stringify(route(store, args.request, args.capability), null, 2));
    return;
  }
  if (args.cmd === 'hop') {
    // hop: move from the current page's node to a related node in the graph.
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { hop } = await import('./graph/hop.js');
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    console.log(JSON.stringify(
      hop(store, args.url, { toCluster: args.toCluster, toNode: args.toNode }), null, 2));
    return;
  }
  if (args.cmd === 'graph') {
    // graph: export the whole internet graph as a visualization-ready JSON view.
    // Pure structural read over the seeded graph — no browser. Seed on first use.
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { buildGraphView } = await import('./graph/export.js');
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    const view = buildGraphView(store);
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  if (args.cmd === 'node-add') {
    // node-add: teach webnav a new site (persisted; the viz UI reads the same store).
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { addNode } = await import('./graph/teach.js');
    const store = new MapStore('webnav.db');
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
    const store = new MapStore('webnav.db');
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
    const rec = new RecordStore(process.env.WEBNAV_DB ?? 'webnav.db');
    const session = args.session || `map-${Date.now()}`;
    rec.start(session);
    console.log(JSON.stringify({ status: 'recording', session }, null, 2));
    return;
  }
  if (args.cmd === 'record-stop') {
    const { RecordStore } = await import('./mapstore/record.js');
    new RecordStore(process.env.WEBNAV_DB ?? 'webnav.db').stop(args.session);
    console.log(JSON.stringify({ status: 'stopped', session: args.session }, null, 2));
    return;
  }
  if (args.cmd === 'graph-analyse') {
    const { RecordStore } = await import('./mapstore/record.js');
    const { analyseActionEffects } = await import('./explorer/analyse.js');
    const result = analyseActionEffects(new RecordStore(process.env.WEBNAV_DB ?? 'webnav.db').actionEffects(args.session));
    console.log(JSON.stringify(result, null, 2));
    if (result.sites.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'graph-edit') {
    const { MapStore } = await import('./mapstore/store.js');
    const { editGraph } = await import('./graph/edit.js');
    const store = new MapStore(process.env.WEBNAV_DB ?? 'webnav.db');
    const graph = JSON.parse(args.graph);
    console.log(JSON.stringify(editGraph(store, args.node, graph), null, 2));
    return;
  }
  if (args.cmd === 'graph-show') {
    const { MapStore } = await import('./mapstore/store.js');
    const { showInterior } = await import('./graph/show.js');
    console.log(JSON.stringify(showInterior(new MapStore(process.env.WEBNAV_DB ?? 'webnav.db'), args.node), null, 2));
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
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    if (!store.getState(args.start)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.start }, null, 2)); process.exitCode = 2; return; }
    if (!store.getState(args.goal)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.goal }, null, 2)); process.exitCode = 2; return; }
    const path = findPath(store, args.start, args.goal);
    if (!path) { console.log(JSON.stringify({ status: 'failed', reason: 'no route from ' + args.start + ' to ' + args.goal }, null, 2)); process.exitCode = 3; return; }
    const browserSession = 'w-' + Date.now();
    const adapter = new PlaywrightAdapter(browserSession);
    const startState = store.getState(args.start)!;
    await adapter.open(startState.urlPattern || 'about:blank');
    const browser = makeLiveWalkBrowser(adapter, args.inputs);
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + args.goal, startStateId: args.start, goalStateId: args.goal, store, states, browser, path });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      const sessions = new WalkSessionStore('webnav.db');
      const id = sessions.create({ startState: args.start, goalState: args.goal, path, browserSession });
      // pos points at the state the walk paused ON, so resume restarts there.
      const pausedAt = (res as any).at;
      if (typeof pausedAt === 'number') sessions.advance(id, pausedAt);
      console.log(JSON.stringify({ ...res, session: id }, null, 2));
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
    const store = new MapStore('webnav.db');
    const sessions = new WalkSessionStore('webnav.db');
    const w = sessions.load(args.session);
    if (!w) { console.log(JSON.stringify({ status: 'failed', reason: 'no active walk-session ' + args.session }, null, 2)); process.exitCode = 2; return; }
    const answer = args.ref ? { kind: 'ref' as const, ref: args.ref }
      : args.classify ? { kind: 'classify' as const, verdict: args.classify as 'safe' | 'commit' }
      : undefined;
    if (!answer) { console.log(JSON.stringify({ status: 'failed', reason: 'supply --ref or --classify' }, null, 2)); process.exitCode = 2; return; }
    const resumeFrom = w.path[w.pos] ?? w.startState;
    const adapter = new PlaywrightAdapter(w.browserSession);   // reattach the live browser
    const browser = makeLiveWalkBrowser(adapter, {});
    const startState = store.getState(resumeFrom) ?? store.getState(w.startState)!;
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + w.goalState, startStateId: resumeFrom, goalStateId: w.goalState, store, states, browser, path: w.path, answer });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      const pausedAt = (res as any).at;
      sessions.advance(args.session, typeof pausedAt === 'number' ? pausedAt : w.pos + 1);
      console.log(JSON.stringify({ ...res, session: args.session }, null, 2));
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
    const adapter = new PlaywrightAdapter(args.session);
    try {
      // `open` creates the session if new AND navigates; it also works to
      // re-navigate an existing session (whereas `goto` requires the session to
      // already exist, which fails on the first navigate of a fresh session).
      await adapter.open(args.url);
      const toSnapshot = await adapter.snapshot();
      const toUrl = await adapter.currentUrl();
      const rec = new RecordStore(process.env.WEBNAV_DB ?? 'webnav.db');
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
        sessionId: args.session, recordStore: new RecordStore(process.env.WEBNAV_DB ?? 'webnav.db'),
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
  // recall: open GitHub search for the query, then drive recall() over the live
  // browser. Prints a RecallResponse JSON for the calling agent.
  if (args.cmd === 'recall') {
    const { runRecallLive } = await import('./router/live.js');
    const response = await runRecallLive(args.query, args.top, 'webnav.db', args.goal);
    console.log(JSON.stringify(response, null, 2));
    if (isEmptyOrFailed(response)) process.exitCode = 3;
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
