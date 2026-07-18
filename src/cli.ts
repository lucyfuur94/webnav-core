import { topLevelHelp, commandHelp } from './cli-help.js';
import { VERSION, COMMANDS } from './cli-spec.js';
import type { BrowserOpts } from './playwright/adapter.js';
import { wireSessionName } from './playwright/adapter.js';
import type { RecordingsDeps } from './dashboard/server.js';
import type { State } from './mapstore/types.js';
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
  | { cmd: 'close'; session: string }
  | { cmd: 'session'; session: string; url: string; browser: BrowserOpts; profile?: string }
  | { cmd: 'record-start'; session: string }
  | { cmd: 'record-stop'; session: string }
  | { cmd: 'record-live'; session: string; url: string; interval: number; browser: BrowserOpts }
  | { cmd: 'graph-analyse'; sessions: string[]; host?: string; draft: boolean; skipReviewGate: boolean }
  | { cmd: 'graph-edit'; node: string; graph: string }
  | { cmd: 'graph-show'; node: string }
  | { cmd: 'node-clear'; node: string }
  | { cmd: 'node-rm'; node: string }
  | { cmd: 'import-map'; file: string }
  | { cmd: 'pattern-propose'; fromUnknown: string; name: string; lint?: string }
  | { cmd: 'export-map'; node: string }
  | { cmd: 'outline'; node: string }
  | { cmd: 'mermaid'; node: string }
  | { cmd: 'frontier'; node: string; exclude: string[] }
  | { cmd: 'navigate'; url: string; session: string; browser: BrowserOpts }
  | { cmd: 'snapshot'; session: string }
  | { cmd: 'click'; ref: string; session: string }
  | { cmd: 'type'; ref: string; text: string; session: string }
  | { cmd: 'walk'; start: string; goal: string; inputs: Record<string, string>; browser: BrowserOpts; hosted: boolean; observe: string[]; observeDynamic: boolean }
  | { cmd: 'test'; suite: string; browser: BrowserOpts }
  | { cmd: 'walk-resume'; session: string; ref?: string; classify?: string; continue: boolean; inputs: Record<string, string> }
  | { cmd: 'login'; key: string }
  | { cmd: 'creds'; sub: string; site?: string; key?: string; values: Record<string, string> }
  | { cmd: 'effects'; session: string }
  | { cmd: 'record-rename'; from: string; to: string }
  | { cmd: 'review'; session: string; model: string; instructions?: string }
  | { cmd: 'capture-loop'; objective: string; exploreCmd: string; sessionPrefix: string; maxRounds: number; model: string }
  | { cmd: 'verify'; node: string; session: string }
  | { cmd: 'hover-probe'; session: string; limit: number; rightClick: boolean }
  | { cmd: 'profile-status'; profile: string; site: string; url?: string }
  | { cmd: 'sessions'; sub: string; all: boolean; maxAgeHours?: number }
  | { cmd: 'mcp' }
  | { cmd: 'dashboard'; port: number; open: boolean }
  | { cmd: 'ingest'; port: number }
  | { cmd: 'agent-serve'; port: number }
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

// Collect EVERY value of a repeated flag (e.g. `--session a --session b`). Used by
// graph-analyse to draft from MULTIPLE recording sessions of one site in one pass.
function flagValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
  return out;
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
  if (cmd === 'close') return { cmd, session: flagValue(rest, '--session') ?? rest.find((a) => !a.startsWith('--')) ?? '' };
  if (cmd === 'session') return { cmd, session: flagValue(rest, '--session') ?? '', url: flagValue(rest, '--url') ?? rest.find((a) => !a.startsWith('--')) ?? 'about:blank', browser: browserOpts(rest), profile: flagValue(rest, '--profile') };
  if (cmd === 'record-start') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'record-stop') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'record-live') return { cmd, session: flagValue(rest, '--session') ?? '', url: flagValue(rest, '--url') ?? '', interval: Number(flagValue(rest, '--interval') ?? 500), browser: browserOpts(rest) };
  // session comes from --session, falling back to the first positional — both humans
  // and agents naturally type `graph-analyse <id> --draft`, and the flag-only parse
  // silently queried session '' and reported "empty" (live-acceptance trap).
  // sessions: repeated --session flags, or a single positional; --host <h> auto-includes
  // every recorded session for that host (drafts the whole site from all its drives at once).
  if (cmd === 'graph-analyse') {
    const multi = flagValues(rest, '--session');
    const host = flagValue(rest, '--host');
    // positional session fallback (`graph-analyse <id>`) ONLY when no --session/--host given —
    // else `--host x` would grab `x` as a positional. Skip a value that follows a value-flag.
    const flagVals = new Set(['--host', '--session', '--browser', '--profile'].flatMap((f) => { const i = rest.indexOf(f); return i >= 0 ? [rest[i + 1]] : []; }));
    const pos = (!multi.length && !host) ? rest.find((a) => !a.startsWith('--') && !flagVals.has(a)) : undefined;
    const sessions = multi.length ? multi : (pos ? [pos] : []);
    return { cmd, sessions, host, draft: rest.includes('--draft'), skipReviewGate: rest.includes('--skip-review-gate') };
  }
  if (cmd === 'graph-edit') return { cmd, node: flagValue(rest, '--node') ?? '', graph: flagValue(rest, '--graph') ?? '' };
  if (cmd === 'graph-show') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'node-clear') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'node-rm') return { cmd, node: flagValue(rest, '--node') ?? '' };
  if (cmd === 'import-map') return { cmd, file: flagValue(rest, '--file') ?? rest[0] ?? '' };
  if (cmd === 'pattern-propose') {
    return { cmd, fromUnknown: flagValue(rest, '--from-unknown') ?? '', name: flagValue(rest, '--name') ?? '', lint: flagValue(rest, '--lint') };
  }
  if (cmd === 'export-map') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  // outline/mermaid take the site as a positional OR --node (ergonomic: `outline <site>`).
  if (cmd === 'outline') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  if (cmd === 'mermaid') return { cmd, node: flagValue(rest, '--node') ?? rest[0] ?? '' };
  // frontier: --node (or positional) + repeatable --exclude <label> (caller's hard "never click" list).
  if (cmd === 'frontier') {
    const excludeVals = new Set(flagValues(rest, '--exclude'));
    const node = flagValue(rest, '--node') ?? rest.find((a) => !a.startsWith('--') && !excludeVals.has(a)) ?? '';
    return { cmd, node, exclude: [...excludeVals] };
  }
  if (cmd === 'effects') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'record-rename') return { cmd, from: flagValue(rest, '--from') ?? '', to: flagValue(rest, '--to') ?? '' };
  if (cmd === 'review') return { cmd, session: flagValue(rest, '--session') ?? rest.find((a) => !a.startsWith('--')) ?? '', model: flagValue(rest, '--model') ?? 'sonnet', instructions: flagValue(rest, '--instructions') };
  if (cmd === 'capture-loop') return { cmd, objective: flagValue(rest, '--objective') ?? '', exploreCmd: flagValue(rest, '--explore-cmd') ?? '', sessionPrefix: flagValue(rest, '--session-prefix') ?? 'cl', maxRounds: Number(flagValue(rest, '--max-rounds') ?? 5), model: flagValue(rest, '--model') ?? 'sonnet' };
  if (cmd === 'verify') return { cmd, node: flagValue(rest, '--node') ?? '', session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'hover-probe') return { cmd, session: flagValue(rest, '--session') ?? '', limit: Number(flagValue(rest, '--limit') ?? 12), rightClick: rest.includes('--right-click') };
  if (cmd === 'profile-status') {
    return { cmd, profile: flagValue(rest, '--profile') ?? '', site: flagValue(rest, '--site') ?? '', url: flagValue(rest, '--url') };
  }
  if (cmd === 'sessions') {
    const maxAge = flagValue(rest, '--max-age-hours');
    return { cmd, sub: rest.find((a) => !a.startsWith('--')) ?? 'list',
      all: rest.includes('--all'), maxAgeHours: maxAge ? Number(maxAge) : undefined };
  }
  if (cmd === 'mcp') return { cmd };
  if (cmd === 'dashboard') {
    const portFlag = flagValue(rest, '--port');
    const port = Number(portFlag ?? process.env.WEBNAV_PORT ?? 7777);
    return { cmd, port, open: rest.includes('--open') };
  }
  if (cmd === 'ingest') return { cmd, port: Number(flagValue(rest, '--port') ?? 7778) };
  if (cmd === 'agent-serve') return { cmd, port: Number(flagValue(rest, '--port') ?? 7779) };
  if (cmd === 'walk') {
    return { cmd, start: flagValue(rest, '--start') ?? '', goal: flagValue(rest, '--goal') ?? '',
      inputs: inputFlags(rest), browser: browserOpts(rest), hosted: rest.includes('--hosted'),
      observe: flagValues(rest, '--observe'), observeDynamic: rest.includes('--observe-dynamic') };
  }
  if (cmd === 'test') {
    return { cmd, suite: flagValue(rest, '--suite') ?? rest.find((a) => !a.startsWith('--')) ?? '', browser: browserOpts(rest) };
  }
  if (cmd === 'walk-resume') {
    return { cmd, session: rest.find((a) => !a.startsWith('--')) ?? '',
      ref: flagValue(rest, '--ref'), classify: flagValue(rest, '--classify'),
      continue: rest.includes('--continue'),
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
    // open then snapshot WITH READINESS RETRY — a JS SPA renders after the first paint, so a
    // bare immediate snapshot catches an unfinished shell and read wrongly reports
    // `blocked: loading`. snapshotReady waits for the page to actually render.
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
  if (args.cmd === 'session') {
    // Interactive long-lived agent session: ONE process owns the browser + video +
    // record loop, reads JSON-line commands on stdin, writes JSON results on stdout,
    // closes cleanly on quit/EOF. This is the shape that lets video span the whole
    // session and leaks nothing (spec: 2026-07-09-interactive-agent-session-design.md).
    if (!args.session) { console.log(JSON.stringify({ ok: false, error: 'usage: webnav use session --session <S> [--url <U>] [--profile <name>]' })); process.exitCode = 2; return; }
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const { runAgentSession, OVERLAY_ON_JS } = await import('./recorder/agent-session.js');
    const { parseSnapshot } = await import('./playwright/snapshot.js');
    const { recoverFingerprint } = await import('./playwright/fingerprint.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    const readline = await import('node:readline');

    const store = new RecordStore(dbPath());
    const videosRoot = join(homedir(), '.webnav', 'recordings');
    const profilesRoot = join(homedir(), '.webnav', 'profiles');
    // profile resolve + prep (same discipline as every other launch path)
    const sbrowser = { ...args.browser };
    // Maximized-window config for HEADED capture sessions (repo-root playwright-cli.json;
    // adapter applies it only when headed). Resolved from THIS module so CWD doesn't matter.
    if (sbrowser.headed) {
      const { fileURLToPath } = await import('node:url');
      sbrowser.configPath = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'playwright-cli.json');
    }
    let profName: string | null = null;
    if (args.profile) {
      const { resolveProfile } = await import('./playwright/adapter.js');
      const { prepProfile } = await import('./playwright/profile-lock.js');
      sbrowser.profile = resolveProfile(args.profile, profilesRoot);
      profName = sbrowser.profile.split('/').pop() ?? null;
      try { mkdirSync(sbrowser.profile, { recursive: true }); } catch { /* */ }
      prepProfile(sbrowser.profile);
    }
    const adapter = new PlaywrightAdapter(args.session, undefined, undefined, sbrowser);
    // realtime → dashboard: best-effort POST to /api/notify so it pushes SSE. The
    // dashboard is a SEPARATE process; this is the cross-process bridge.
    const dashPort = Number(process.env.WEBNAV_DASHBOARD_PORT ?? 7777);
    const notify = (kind: string, line?: string) => {
      const body = JSON.stringify({ kind, line });
      // fire-and-forget; a missing dashboard is fine (store still has the truth)
      import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port: dashPort, path: '/api/notify', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => res.resume());
        req.on('error', () => {}); req.write(body); req.end();
      }).catch(() => {});
    };
    try {
      await adapter.open(args.url);
      if (sbrowser.profile && args.url && args.url !== 'about:blank') { try { await adapter.goto(args.url); } catch { /* past restored tab */ } }
      await adapter.evalJs(OVERLAY_ON_JS).catch(() => {});   // best-effort: video overlay on the starting page
      store.start(args.session);
      store.setOrigin(args.session, 'agent');
      if (profName) store.setProfile(args.session, profName);
      if (args.url && args.url !== 'about:blank') store.setStartUrl(args.session, args.url);

      const rl = readline.createInterface({ input: process.stdin });
      const lines: string[] = []; const waiters: ((l: string | null) => void)[] = [];
      let ended = false;
      rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
      rl.on('close', () => { ended = true; while (waiters.length) waiters.shift()!(null); });
      const readLine = () => new Promise<string | null>((resolve) => {
        if (lines.length) return resolve(lines.shift()!);
        if (ended) return resolve(null);
        waiters.push(resolve);
      });

      await runAgentSession({
        sessionId: args.session, adapter: adapter as never, store: store as never,
        recover: (snap, ref) => {
          const nodes = parseSnapshot(snap);
          const chosen = nodes.find((n) => n.ref === ref);
          const elementFp = recoverFingerprint(nodes, ref);
          return { action: chosen ? { role: chosen.role, name: chosen.name, ref, elementFp } : { role: '', name: null, ref } };
        },
        readLine, write: (l) => process.stdout.write(l + '\n'), notify,
        startVideo: async () => {
          try { await adapter.videoStart(); notify('log', 'video: recording started'); }
          catch { notify('log', 'video: START FAILED'); }
        },
        stopVideo: async () => {
          const dir = join(videosRoot, args.session);
          try { mkdirSync(dir, { recursive: true }); } catch { /* */ }
          const file = join(dir, 'take-' + Date.now() + '.webm');
          const ok = await adapter.videoStop(file).catch(() => false);
          const { existsSync } = await import('node:fs');
          // video-stop can return before the .webm is fully flushed; poll briefly so
          // the file is present before this process exits (else the write is lost).
          for (let i = 0; ok && i < 25 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 200));
          if (ok && existsSync(file)) { notify('log', 'video: saved ' + file); return file; }
          notify('log', 'video: no frames captured'); return null;
        },
        startUrl: args.url,
      });
      rl.close();
    } finally {
      store.stop(args.session);
      notify('sessions');
    }
    return;
  }
  if (args.cmd === 'close') {
    // Explicit teardown for a `use` session (agent's "I'm done" — the `use` verbs
    // keep the browser alive between calls, so SOMETHING must close it; this is it).
    if (!args.session) { console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav use close --session <S>' }, null, 2)); process.exitCode = 2; return; }
    const { closeByName } = await import('./playwright/sessions.js');
    let closed = false;
    try { closed = await closeByName(args.session); } catch { /* already gone */ }
    console.log(JSON.stringify({ status: closed ? 'closed' : 'not-found', session: args.session }, null, 2));
    if (!closed) process.exitCode = 3;
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
    rec.setOrigin(session, 'agent');
    console.log(JSON.stringify({ status: 'recording', session }, null, 2));
    return;
  }
  if (args.cmd === 'record-stop') {
    const { RecordStore } = await import('./mapstore/record.js');
    new RecordStore(dbPath()).stop(args.session);
    // Close the browser too — record-stop is the end of an agent session, so its
    // window must not leak (the `use` verbs keep the session alive between calls;
    // record-stop is the sanctioned teardown). A long-lived `record-live` owns its
    // own adapter and closes on its own loop end — this closeByName is a no-op there.
    const { closeByName } = await import('./playwright/sessions.js');
    let closed = false;
    try { closed = await closeByName(args.session); } catch { /* already gone */ }
    console.log(JSON.stringify({ status: 'stopped', session: args.session, closed }, null, 2));
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
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const store = new RecordStore(dbPath());
    store.start(args.session);
    store.setOrigin(args.session, 'manual');
    const videosRoot = join(homedir(), '.webnav', 'recordings');
    // --profile resolve + prep (parity with the dashboard/agent paths): one
    // long-lived process OWNS the session, so video capture survives the whole span.
    const rlBrowser = { ...args.browser };
    if (rlBrowser.profile) {
      const { resolveProfile } = await import('./playwright/adapter.js');
      const { prepProfile } = await import('./playwright/profile-lock.js');
      rlBrowser.profile = resolveProfile(rlBrowser.profile, join(homedir(), '.webnav', 'profiles'));
      try { (await import('node:fs')).mkdirSync(rlBrowser.profile, { recursive: true }); } catch { /* */ }
      prepProfile(rlBrowser.profile);
      store.setProfile(args.session, rlBrowser.profile.split('/').pop()!);
    }
    store.setStartUrl(args.session, args.url);
    // finally-guard: a throw anywhere below (adapter.open on a dead URL, the loop
    // itself) must not leave the record session dangling active=1 in the DB.
    try {
      const adapter = new PlaywrightAdapter(args.session, undefined, undefined, rlBrowser);
      await adapter.open(args.url);
      // Video: started here, stopped in finally — SAME process owns the session the
      // whole time, so playwright-cli actually records it (the split-process agent
      // flow could not — this long-lived process is how agent sessions get video).
      // Video: started here, stopped in onBeforeClose (while the session is still
      // open — after adapter.close() playwright-cli saves nothing). One long-lived
      // process owns the session, so unlike the split agent CLI calls this CAN record.
      const { mkdirSync } = await import('node:fs');
      let videoStarted = false;
      await adapter.videoStart().then(() => { videoStarted = true; process.stderr.write('video: recording started\n'); }, () => process.stderr.write('video: START FAILED\n'));
      let stopped = false;
      process.on('SIGINT', () => { stopped = true; });
      process.stderr.write(`recording — drive the browser (human clicks or agent \`use\` on session ${args.session}); stop with Ctrl-C or \`webnav dev record-stop --session ${args.session}\`\n`);
      const res = await runLiveRecord({
        adapter, store, sessionId: args.session, intervalMs: args.interval,
        log: (l) => process.stderr.write(l + '\n'), isStopped: () => stopped,
        onBeforeClose: async () => {
          if (!videoStarted) return;
          const dir = join(videosRoot, args.session);
          try { mkdirSync(dir, { recursive: true }); } catch { /* */ }
          const file = join(dir, 'take-' + Date.now() + '.webm');
          const ok = await adapter.videoStop(file).catch(() => false);
          const { existsSync } = await import('node:fs');
          process.stderr.write(ok && existsSync(file) ? 'video: saved ' + file + '\n' : 'video: no frames captured\n');
        },
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
    const store = new RecordStore(dbPath());
    // Resolve the session set: explicit --session (repeatable), or every recorded session
    // for --host. MULTIPLE sessions of one site fold into ONE draft: their effects are
    // concatenated in order and stable-pathname keying merges same-page visits automatically.
    let sessionIds = args.sessions;
    if (args.host) {
      sessionIds = store.listSessions().filter((s) => s.site === args.host && s.steps > 0)
        .map((s) => s.sessionId);
    }
    if (sessionIds.length === 0) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev graph-analyse --session <S> [--session <S2> …] [--host <h>] [--draft]' }, null, 2));
      process.exitCode = 2; return;
    }
    // APPROVAL GATE: only build the map from sessions whose capture-review PASSED. A failed OR
    // never-reviewed session is NOT trusted — training the graph on it would bake in whatever the
    // review flagged (a missed step, a broken capture). --skip-review-gate bypasses for a
    // deliberate raw build. Excluded sessions are reported, not silently dropped.
    const excluded: { session: string; reason: string }[] = [];
    if (!args.skipReviewGate) {
      const kept: string[] = [];
      for (const id of sessionIds) {
        const rev = store.reviewOf(id);
        if (rev?.approved) kept.push(id);
        else excluded.push({ session: id, reason: rev ? `review failed (${rev.gaps} gap${rev.gaps===1?'':'s'})` : 'never reviewed' });
      }
      sessionIds = kept;
      if (sessionIds.length === 0) {
        console.log(JSON.stringify({ status: 'error', reason: 'no APPROVED sessions to build from', excluded,
          hint: 'run `webnav dev review --session <S>` until it passes, or pass --skip-review-gate to build from raw sessions anyway' }, null, 2));
        process.exitCode = 2; return;
      }
    }
    const effects = sessionIds.flatMap((id) => store.actionEffects(id));
    if (args.draft) {
      // --draft: fold the recorded walk-through(s) into a ready, SELF-VERIFIED {node,states,edges}
      // graph-edit spec (absolute URLs, uniqueness fingerprints, resolvable edges) so learning
      // is "drive → accept", not hand-author. The agent pipes it straight to graph-edit.
      const { draftFromEffects } = await import('./explorer/draft.js');
      const draft = draftFromEffects(effects);
      console.log(JSON.stringify({ status: draft.states.length ? 'done' : 'empty', sessions: sessionIds,
        ...(excluded.length ? { excludedUnverified: excluded } : {}), ...draft }, null, 2));
      if (draft.states.length === 0) process.exitCode = 3;
      return;
    }
    const { analyseActionEffects } = await import('./explorer/analyse.js');
    const result = analyseActionEffects(effects);
    console.log(JSON.stringify({ ...result, ...(excluded.length ? { excludedUnverified: excluded } : {}) }, null, 2));
    if (result.sites.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'ingest') {
    // Long-lived localhost receiver (like `dashboard`/`mcp`): does NOT print-and-exit.
    // The webnav-extension Chrome extension POSTs recorded sessions here; they land
    // in webnav.db as ActionEffects via `serveIngest` -> `ingest` (Task 2).
    const { serveIngest } = await import('./recorder/ingest.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const server = serveIngest(args.port, new RecordStore(dbPath()));
    process.stderr.write(`webnav ingest listening on http://127.0.0.1:${args.port}/ingest\n`);
    console.log(JSON.stringify({ status: 'listening', port: args.port }));
    await new Promise(() => {}); // run until killed
    return;
  }
  if (args.cmd === 'agent-serve') {
    // Long-lived localhost receiver (like `ingest`/`dashboard`): the Chrome extension
    // sidePanel's local server. Streams AgentEvent over SSE, accepts a goal, runs the
    // agent loop over a real AgentChannel that drives the extension's tab, and mounts
    // /ingest-ax so a live goal run is recorded through the same path human/agent
    // recordings use (Task 3).
    const { serveAgent } = await import('./agent/server.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const { runAgentGoal } = await import('./agent/loop.js');
    const { makeLiveExtensionBrowser } = await import('./router/live-extension-browser.js');
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    // ponytail: one MapStore for the server's lifetime — same seeded map the `walk`
    // verb uses, so check_route/walkRoute route against the real states. Extra sites
    // recorded via /ingest-ax build the RecordStore, not this map; that's fine — the
    // loop drives manually when the live page isn't a known state.
    const mapStore = new MapStore();
    ensureSeeded(mapStore);
    const states = mapStore.allStates();
    // onGoal: a goal POST runs the loop. Inputs = {} for v1 — the goal body carries no
    // site/start-state to key CredStore by; the extension user is already logged in on
    // the live tab, and creds-injection is a walk-verb concern. Real SDK query runs.
    const onGoal = async (
      goal: import('./agent/server.js').AgentGoalBody,
      channel: import('./router/live-extension-browser.js').AgentChannel,
      emit: (e: import('./agent/server.js').AgentEvent) => void,
    ): Promise<void> => {
      const browser = makeLiveExtensionBrowser(channel, {});
      // ponytail: no /stop AbortSignal threaded — the server rejects pending commands
      // on /stop (server.ts), which fails the in-flight tool and surfaces as an error
      // event. TODO(stop): thread a real AbortSignal per goal if the SDK query itself
      // needs cancelling mid-turn (currently it just fails the next browser command).
      await runAgentGoal({
        goal: goal.goal,
        sessionId: goal.sessionId,
        mode: goal.mode as 'ask' | 'auto' | 'act',
        browser,
        store: mapStore,
        states,
        emit,
      });
    };
    const server = serveAgent(args.port, new RecordStore(dbPath()), { onGoal });
    process.stderr.write(`webnav agent-serve listening on http://127.0.0.1:${args.port}\n`);
    console.log(JSON.stringify({ status: 'listening', port: args.port }));
    await new Promise(() => {}); // run until killed
    return;
  }
  if (args.cmd === 'record-rename') {
    // Rename a recording's id (DB row + its observations) AND move its on-disk video/review
    // dirs, so a session reads as what it captures (reports-list) not an ad-hoc id (s1final).
    if (!args.from || !args.to) { console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev record-rename --from <id> --to <id>' }, null, 2)); process.exitCode = 2; return; }
    const { RecordStore } = await import('./mapstore/record.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { renameSync, existsSync } = await import('node:fs');
    const ok = new RecordStore(dbPath()).renameSession(args.from, args.to);
    if (!ok) { console.log(JSON.stringify({ status: 'error', reason: `cannot rename: '${args.from}' unknown or '${args.to}' already exists` }, null, 2)); process.exitCode = 2; return; }
    // move on-disk recordings/ + reviews/ dirs to match (best-effort; DB is the source of truth)
    for (const root of ['recordings', 'reviews']) {
      const src = join(homedir(), '.webnav', root, args.from);
      const dst = join(homedir(), '.webnav', root, args.to);
      if (existsSync(src) && !existsSync(dst)) { try { renameSync(src, dst); } catch { /* */ } }
    }
    console.log(JSON.stringify({ status: 'done', from: args.from, to: args.to }, null, 2));
    return;
  }
  if (args.cmd === 'review') {
    // Audit ONE recorded session's VIDEO against its captured STEPS (Sonnet over ffmpeg
    // frames) → capture gaps. Writes a review verdict tag on the session: APPROVED (zero
    // gaps → graph-ready) or needs-fix (gaps listed). This is the per-session gate the
    // user asked for. Reuses runSessionReview (the same call capture-loop makes).
    if (!args.session) { console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev review --session <S> [--model sonnet]' }, null, 2)); process.exitCode = 2; return; }
    const { RecordStore } = await import('./mapstore/record.js');
    const { runSessionReview } = await import('./recorder/review.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const store = new RecordStore(dbPath());
    const fx = store.actionEffects(args.session);
    if (fx.length === 0) { console.log(JSON.stringify({ status: 'empty', session: args.session, hint: 'no captured steps — nothing to review' }, null, 2)); process.exitCode = 3; return; }
    const steps = fx.map((e) => ({
      seq: e.seq,
      kind: e.action ? (e.action.hover ? 'hover' : e.navigated ? 'navigate' : e.action.role === 'textbox' ? 'input' : 'click') : (e.navigated ? 'jump' : 'observe'),
      label: e.action?.name ?? e.toUrl, value: e.action?.value, capturedAt: e.capturedAt,
    }));
    const { coverage, landingStructure } = await import('./recorder/coverage.js');
    const cov = coverage(store.events(args.session));
    const videosRoot = join(homedir(), '.webnav', 'recordings');
    const reviewsRoot = join(homedir(), '.webnav', 'reviews');
    const res = await runSessionReview(args.session, {
      videosDir: join(videosRoot, args.session), outDir: join(reviewsRoot, args.session),
      steps, logs: [], log: (l) => process.stderr.write(l + '\n'),
      claudeModel: args.model, instructions: args.instructions, structured: true,
      knownDrops: cov.dropped, coverage: cov, structure: landingStructure(fx),
    });
    const gaps = typeof res === 'string' ? [] : res.gaps;
    const approved = gaps.length === 0;
    const at = Date.now();
    store.setReview(args.session, { approved, gaps: gaps.length, at, model: args.model,
      reason: approved ? 'all on-screen actions captured' : `${gaps.length} capture gap(s)` });
    console.log(JSON.stringify({ status: approved ? 'approved' : 'needs-fix', session: args.session,
      approved, gaps, coverage: cov, report: join(reviewsRoot, args.session, 'review.md') }, null, 2));
    if (!approved) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'effects') {
    const { RecordStore } = await import('./mapstore/record.js');
    const effects = new RecordStore(dbPath()).actionEffects(args.session);
    console.log(JSON.stringify({ status: effects.length ? 'done' : 'empty', session: args.session, effects }, null, 2));
    if (effects.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'capture-loop') {
    // Self-improving capture loop: each round runs --explore-cmd (which drives ONE
    // agent exploration of the objective via `use session`, recording session
    // $WEBNAV_LOOP_SESSION), then a STRUCTURED review audits video-vs-steps for gaps.
    // Converges on a clean audit; else exits 3 with the gaps for a recorder-code fix.
    // webnav stays zero-LLM: the exploring AGENT lives in --explore-cmd (caller wires
    // a Haiku driver), not here. spec: 2026-07-09-capture-improvement-loop-design.md
    if (!args.objective || !args.exploreCmd) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev capture-loop --objective "<text>" --explore-cmd "<cmd that drives $WEBNAV_LOOP_SESSION>" [--max-rounds N] [--model sonnet]' }, null, 2));
      process.exitCode = 2; return;
    }
    const { runCaptureLoop } = await import('./recorder/capture-loop.js');
    const { runSessionReview } = await import('./recorder/review.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const { execSync } = await import('node:child_process');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const store = new RecordStore(dbPath());
    const videosRoot = join(homedir(), '.webnav', 'recordings');
    const reviewsRoot = join(homedir(), '.webnav', 'reviews');
    const result = await runCaptureLoop({
      objective: args.objective, maxRounds: args.maxRounds,
      log: (l) => process.stderr.write(l + '\n'),
      explore: async (round) => {
        // SHORT session name: the playwright-cli daemon socket path embeds it and
        // macOS caps socket paths at ~104 chars (learned before). base36 seconds + round.
        const stamp = Math.floor(Date.now() / 1000).toString(36);   // ~6 chars
        const session = (args.sessionPrefix + 'r' + round + stamp).slice(0, 14);
        try {
          execSync(args.exploreCmd, { stdio: 'inherit', timeout: 5 * 60_000,
            env: { ...process.env, WEBNAV_LOOP_SESSION: session, WEBNAV_LOOP_OBJECTIVE: args.objective } });
        } catch { /* explore-cmd non-zero → treat as recorded-what-it-could */ }
        // re-open the store to see the subprocess's committed writes (a long-lived
        // connection can hold a stale snapshot across another process's commit).
        const fresh = new RecordStore(dbPath());
        return fresh.actionEffects(session).length ? session : null;
      },
      review: async (session) => {
        const fresh = new RecordStore(dbPath());
        const fx = fresh.actionEffects(session);
        const steps = fx.map((e) => ({
          seq: e.seq, kind: e.action ? (e.action.hover ? 'hover' : e.navigated ? 'navigate' : e.action.role === 'textbox' ? 'input' : 'click') : (e.navigated ? 'jump' : 'observe'),
          label: e.action?.name ?? e.toUrl, value: e.action?.value, capturedAt: e.capturedAt,
        }));
        const { coverage, landingStructure } = await import('./recorder/coverage.js');
        const cov = coverage(fresh.events(session));
        const res = await runSessionReview(session, { videosDir: join(videosRoot, session), outDir: join(reviewsRoot, session),
          steps, logs: [], log: (l) => process.stderr.write(l + '\n'), claudeModel: args.model, structured: true,
          knownDrops: cov.dropped, coverage: cov, structure: landingStructure(fx) });
        return typeof res === 'string' ? [] : res.gaps;
      },
    });
    console.log(JSON.stringify({ status: result.status,
      rounds: result.rounds.map((r) => ({ round: r.round, session: r.session, gaps: r.gaps.length })),
      gaps: result.gaps }, null, 2));
    if (result.status !== 'clean') process.exitCode = 3;   // needs-fix / max-rounds
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
  if (args.cmd === 'hover-probe') {
    // X2 (spec 2026-07-16 §2): an OPT-IN pass over the CURRENT page of a LIVE recording
    // session. Hover (or --right-click) each structural candidate, diff the reveal, and
    // append a reveal ActionEffect to the same recording. Attaches by session name (the
    // `dev verify --session` shape) and appends like the agent-session loop.
    if (!args.session) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev hover-probe --session <S> [--limit N] [--right-click]' }, null, 2));
      process.exitCode = 2; return;
    }
    const { RecordStore } = await import('./mapstore/record.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { runHoverProbe } = await import('./recorder/hover-probe.js');
    const store = new RecordStore(dbPath());
    // The probe WRITES effects; a session that isn't recording would silently drop them
    // (appendEvent/appendActionEffect are isActive-gated). That's dishonest, so refuse.
    if (!store.isActive(args.session)) {
      console.log(JSON.stringify({ status: 'error', session: args.session, hint: `session '${args.session}' is not recording — start it with 'dev record-start --session ${args.session}' and drive it to the page first` }, null, 2));
      process.exitCode = 2; return;
    }
    const adapter = new PlaywrightAdapter(args.session);
    const { probed, revealed } = await runHoverProbe({
      adapter, store, sessionId: args.session, limit: args.limit, rightClick: args.rightClick,
      log: (l) => process.stderr.write(l + '\n'),
    });
    console.log(JSON.stringify({ status: revealed ? 'done' : 'empty', session: args.session, probed, revealed }, null, 2));
    if (revealed === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'profile-status') {
    // "Am I logged in?" checked BEFORE walking/recording an authed site, instead of
    // guessing and hitting a stale-login wall mid-walk. One polite headless load of
    // the site's entry url (map homeUrl, or --url override), settled + classified
    // against the map's own fingerprints (the oracle) — then the session this verb
    // opened is ALWAYS reaped, success or failure.
    if (!args.profile || !args.site) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav dev profile-status --profile <p> --site <host> [--url <u>]' }, null, 2));
      process.exitCode = 2; return;
    }
    const { MapStore } = await import('./mapstore/store.js');
    const store = new MapStore(dbPath());
    const node = store.getNode(args.site);
    const url = args.url ?? node?.homeUrl;
    if (!url) {
      console.log(JSON.stringify({ status: 'error', hint: `no map for site '${args.site}' yet (no homeUrl) — pass --url, or map the site first with dev record-start` }, null, 2));
      process.exitCode = 2; return;
    }
    const { homedir: homedir3 } = await import('node:os');
    const { join: join3 } = await import('node:path');
    const { resolveProfile, PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { prepProfile } = await import('./playwright/profile-lock.js');
    const { settleSnapshot } = await import('./router/browse.js');
    const { classifyAuthLanding } = await import('./router/auth-status.js');
    const profilesRoot3 = join3(homedir3(), '.webnav', 'profiles');
    const profileDir = resolveProfile(args.profile, profilesRoot3);
    try { (await import('node:fs')).mkdirSync(profileDir, { recursive: true }); } catch { /* */ }
    prepProfile(profileDir);
    // SHORT session id: the playwright-cli daemon socket path embeds it and macOS
    // caps socket paths at ~104 chars (same constraint as capture-loop's session name).
    const session = 'pchk-' + Math.random().toString(36).slice(2, 6);
    const adapter = new PlaywrightAdapter(session, undefined, undefined, { headed: false, persistent: true, profile: profileDir });
    try {
      await adapter.open(url);
      const landedUrl = await adapter.currentUrl();
      const snapshot = await settleSnapshot(() => adapter.snapshot());
      const states = store.statesForNode(args.site);
      const { auth, loginUrl } = classifyAuthLanding(landedUrl, snapshot, args.site, states);
      console.log(JSON.stringify({
        status: 'ok', auth, site: args.site, profile: args.profile,
        checkedAt: new Date().toISOString(), ...(loginUrl ? { loginUrl } : {}),
      }, null, 2));
      // The verb ran fine even when auth is stale — needs-login is exit 0 (a normal,
      // useful answer), not exit 3 (ran-but-empty/failed). Documented in cli-spec help.
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: String(e) }, null, 2));
      process.exitCode = 2;
    } finally {
      await adapter.close().catch(() => {});
    }
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
  if (args.cmd === 'pattern-propose') {
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { lintPackEntry } = await import('./explorer/patterns.js');

    // RE-CHECK PATH (no standalone `pattern-lint` verb — --lint <file> IS the re-check the plan
    // asks for): re-runs lint on an existing pack file after the agent filled in the TODO trigger.
    // Independent of --from-unknown/--name — just lints whatever file is named.
    if (args.lint) {
      let raw: unknown;
      try { raw = JSON.parse(readFileSync(args.lint, 'utf8')); }
      catch (e: any) { console.log(JSON.stringify({ status: 'error', hint: `could not read/parse ${args.lint}: ${e.message}` }, null, 2)); process.exitCode = 2; return; }
      const entries = Array.isArray(raw) ? raw : [raw];
      const results = entries.map((e, i) => ({ index: i, reasons: lintPackEntry(e) }));
      const allClean = results.every((r) => r.reasons.length === 0);
      console.log(JSON.stringify({
        status: allClean ? 'done' : 'error', file: args.lint, results,
        hint: allClean
          ? `lint clean. Next: re-run graph-analyse --draft on the site that surfaced this gap and confirm the unknown is gone, then add a grammar fixture test, then: gh pr create ...`
          : `lint failed — fix the reasons above (usually: fill trigger.contains with >=1 { role, min?, attr? } predicate) and re-run --lint`,
      }, null, 2));
      if (!allClean) process.exitCode = 2;
      return;
    }

    if (!args.fromUnknown || !args.name) {
      console.log(JSON.stringify({ status: 'error',
        hint: 'usage: webnav dev pattern-propose --from-unknown <graph-analyse-draft.json>#<index> --name <slug>   (or: --lint <pack-file> to re-check)' }, null, 2));
      process.exitCode = 2; return;
    }
    const { parseFromUnknownArg, proposeFromUnknown, ghPrCommand } = await import('./explorer/pattern-propose.js');
    let path: string, index: number;
    try { ({ path, index } = parseFromUnknownArg(args.fromUnknown)); }
    catch (e: any) { console.log(JSON.stringify({ status: 'error', hint: e.message }, null, 2)); process.exitCode = 2; return; }

    let draft: any;
    try { draft = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e: any) { console.log(JSON.stringify({ status: 'error', hint: `could not read/parse ${path}: ${e.message}` }, null, 2)); process.exitCode = 2; return; }
    const unknowns = draft?.unknowns;
    if (!Array.isArray(unknowns) || !unknowns[index]) {
      console.log(JSON.stringify({ status: 'error',
        hint: `${path} has no unknowns[${index}] — pass a graph-analyse --draft JSON file (its "unknowns" array) and a valid index (0..${(unknowns?.length ?? 1) - 1})` }, null, 2));
      process.exitCode = 2; return;
    }
    const unknown = unknowns[index];
    const result = proposeFromUnknown(unknown, args.name);

    if (!result.pack) {
      // core-design boundary: no pack schema field expresses this gap — the honest answer is a
      // core-design issue with the fixture, never a pack (and never a hand-patch). No file written.
      console.log(JSON.stringify({ status: 'declined', kind: unknown.kind, extensionPoint: unknown.extensionPoint,
        reason: result.coreDesignBoundary, evidence: unknown.evidence, context: unknown.context }, null, 2));
      process.exitCode = 3; return;
    }

    const outPath = join('packs', 'patterns', 'proposed', `${args.name}.json`);
    if (existsSync(outPath)) {
      console.log(JSON.stringify({ status: 'error', hint: `${outPath} already exists — pick a different --name or edit it directly` }, null, 2));
      process.exitCode = 2; return;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result.pack, null, 2) + '\n');

    // lint is EXPECTED to fail here — the trigger is a deliberate TODO (empty `contains`). Printing
    // the failure IS the agent's next step, per the plan ("prints the failure as the agent's next step").
    console.log(JSON.stringify({
      status: 'scaffolded',
      file: outPath,
      pack: result.pack,
      lint: result.lintReasons.length ? { clean: false, reasons: result.lintReasons } : { clean: true },
      checklist: [
        `1. Fill trigger.contains in ${outPath} with >=1 { role, min?, attr? } predicate derived from the evidence above (role/attr names only — hostnames/URLs/text are rejected by lint).`,
        `2. Re-check: webnav dev pattern-propose --lint ${outPath}`,
        `3. Re-run graph-analyse --draft on the site that surfaced this gap — this unknown should now be GONE from the report.`,
        `4. Add a grammar fixture test proving the resolved shape (tests/grammar/*.test.ts — see pickers.test.ts for the idiom).`,
        `5. Once green: ${ghPrCommand(result.pack, unknown)}`,
        `   (moves ${outPath} to packs/patterns/core/ for upstream review — NO auto-PR; this command is printed, never run for you.)`,
      ],
    }, null, 2));
    // exit 0: the SCAFFOLD succeeded (file written) — the TODO trigger's expected lint failure is
    // reported IN the JSON body (lint.clean:false + reasons), not as a process failure, so an agent
    // scripting this loop doesn't misread "scaffolded, here's your next step" as an error.
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
  if (args.cmd === 'frontier') {
    // The UNEXPLORED FRONTIER: declared affordances the map never followed to a
    // resolved state. Measures "is exploration complete?" instead of guessing.
    // Exit 3 (ran-fine-but-incomplete) when the frontier is non-empty; 0 when
    // empty (fully explored, minus the caller's hard exclusions). Same
    // ran-but-empty/incomplete convention as outline/mermaid.
    const { MapStore } = await import('./mapstore/store.js');
    const { computeFrontier } = await import('./graph/frontier.js');
    const store = new MapStore(dbPath());
    const states = store.statesForNode(args.node);
    if (!states.length) {
      console.log(JSON.stringify({ status: 'empty', node: args.node,
        hint: `no interior captured for "${args.node}" — map it with the record/teach flow` }, null, 2));
      process.exitCode = 3;
      return;
    }
    const result = computeFrontier(args.node, states, args.exclude);
    console.log(JSON.stringify(result, null, 2));
    // frontier non-empty = work remains; exit 3 (ran fine, incomplete).
    if (result.total > 0) process.exitCode = 3;
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
    const { ReplayController, runReplay, runLedgerReplay } = await import('./recorder/replay.js');
    const { coverage } = await import('./recorder/coverage.js');
    const { draftFromEffects } = await import('./explorer/draft.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, renameSync, existsSync: existsSync2 } = await import('node:fs');
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
    // Reconcile stale-active rows: a session left active=1 by a crashed/killed
    // recorder OR by an agent `use session` process that ended (its /api/notify
    // can race the SSE tab, or get missed) shows "recording" forever in an
    // already-open tab. Any active session with NO live browser process is stale
    // → stop it. Uses REAL process liveness (listPwSessions), never the dashboard's
    // own `busy`, so it never touches a session legitimately active in another
    // live process. Run at boot AND on every `list()` read, so even a missed SSE
    // event self-heals on the next poll/refresh (ground truth, not just a push).
    const reconcileStale = async () => {
      try {
        const live = new Set((await listPwSessions(Date.now())).map((s) => s.name));
        for (const x of recordStore.listSessions()) {
          if (x.active && !live.has(x.sessionId)) recordStore.stop(x.sessionId);
        }
      } catch { /* liveness probe failed → leave flags as-is */ }
    };
    await reconcileStale();
    // Per-(profile,site) auth-status cache — checks are on-demand only (no background
    // polling, per the design doc's non-goals), so this is just last-result memory for
    // the chip; key is 'profile\x00site' (both are already validated [\w.-]+ elsewhere,
    // but the separator is NUL to rule out any collision regardless).
    const statusCache = new Map<string, { auth: 'valid' | 'needs-login' | 'unknown'; loginUrl?: string; checkedAt: string }>();
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
    // A Chrome profile dir opens in ONE process only; an orphan webnav Chrome leaves
    // a SingletonLock and holds the dir → next launch fails / hands off to the orphan
    // (the dashboard-vs-reality desync cluster). prepProfile reaps a live webnav-owned
    // holder + clears stale locks before each persistent launch. (src/playwright/profile-lock.ts)
    const { prepProfile } = await import('./playwright/profile-lock.js');
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
    const { makeVideoSync } = await import('./playwright/video.js');
    const videoSync = makeVideoSync(() => activeAdapter, { videosRoot, log: dlog, onSaved: () => emit('sessions') });
    let activeCtl: InstanceType<typeof ReplayController> | null = null;
    const shotsRoot = join(homedir(), '.webnav', 'replays');
    const rec: RecordingsDeps = {
      list: async () => {
        await reconcileStale();   // ground truth on every read: self-heals a missed/raced SSE 'sessions' event
        return recordStore.listSessions().map((x) => {
          const profile = recordStore.profileOf(x.sessionId);
          let videoCount = 0;
          try { videoCount = readdirSync(join(videosRoot, x.sessionId)).filter((f) => f.endsWith('.webm')).length; } catch { /* none */ }
          return { ...x, profile, hasProfile: !!profile && existsSync2(profileDir(profile)),
            startUrl: recordStore.startUrl(x.sessionId), videoCount, origin: recordStore.originOf(x.sessionId) };
        });
      },
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
      open: async (url: string, session: string, persistent: boolean, armedOnly?: boolean, profile?: string) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        busy = session;
        try {
          // persistent → a NAMED, SHARED profile dir (default 'default'), so a login
          // done once in a profile is reused by EVERY session under it (and by walks
          // via --profile). Without an explicit dir, playwright-cli uses a random temp
          // dir per launch and the login evaporates (live finding).
          const profName = persistent ? (profile && /^[\w.-]+$/.test(profile) ? profile : 'default') : null;
          if (profName) { try { mkdirSync(profileDir(profName), { recursive: true }); } catch { /* */ } prepProfile(profileDir(profName)); }
          const adapter = new PlaywrightAdapter(session, undefined, undefined,
            profName ? { headed: true, persistent: true, profile: profileDir(profName) } : { headed: true });
          await adapter.open(url);
          // A persistent profile RESTORES its previous tab on launch (e.g. the Google
          // account page after an auth bounce). Force-navigate to the requested URL so
          // the window lands on the product, not the restored tab (live bug).
          if (persistent && url && url !== 'about:blank') { try { await adapter.goto(url); } catch { /* */ } }
          // ONE CLICK = OPEN + RECORD (live feedback: asking to press Record again
          // after "Open window" was a redundant second intent). Stop still returns
          // the window to the armed/grey state for another take.
          activeAdapter = adapter;
          if (armedOnly) {
            // armed reopen from a recording's detail: window only; Record is a
            // separate intent there (live feedback #1). Row stays visible.
            recordStore.start(session); recordStore.stop(session);
            recordStore.setOrigin(session, 'manual');
            dlog('window opened (armed) for ' + session);
          } else {
            recordStore.start(session);
            recordStore.setOrigin(session, 'manual');
            videoSync(session, true);
            dlog('recording STARTED: ' + session);
          }
          // record the session's profile + intended start url (row now exists)
          if (profName) recordStore.setProfile(session, profName);
          if (url && url !== 'about:blank') recordStore.setStartUrl(session, url);
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
              // GRACEFUL close only (the loop's finally calls adapter.close() → Chrome
              // exits cleanly, releasing the profile lock and leaving NO "restore pages"
              // bubble). A lingering orphan is handled by prepProfile on the NEXT launch,
              // not an ungraceful pkill here (that was the cause of the restore bubble +
              // reopen loop — advisor finding). Force-kill the daemon GROUP only if it's
              // truly wedged AND the window is gone (resurrection guard).
              if (reason === 'closed') {
                setTimeout(() => { try {
                  if (daemonPid !== undefined && execSync('ps -axo ppid=,comm= | awk \'$1==' + daemonPid + '\'', { encoding: 'utf8' }).toLowerCase().includes('chrom')) {
                    execSync('pkill -f ' + JSON.stringify('-s=' + wireSessionName(session)));
                  }
                } catch { /* gone */ } }, 1500);
              }
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
      // cross-process realtime bridge: a `use session` process POSTs /api/notify →
      // this appends its log line to our buffer and pushes the SSE event, so the
      // dashboard streams an agent session's steps/logs live just like the human one.
      notify: (kind: string, line?: string) => {
        if (line) dlog(line);                       // dlog already emits('log')
        if (kind === 'step' || kind === 'sessions') emit(kind);
      },
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
          const verdict = recordStore.reviewOf(id);   // stored {approved,gaps,...} → verdict banner
          return { report: readFileSync(f, 'utf8'), at: statSync(f).mtimeMs, verdict };
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
      // Profiles are NAMED, shared logged-in browser states (dir name = profile
      // name). Metadata (site, last recording url) is derived from the sessions
      // that use the profile — profiles themselves store only cookies on disk.
      profiles: () => {
        let dirs: string[] = [];
        try { dirs = readdirSync(profilesRoot); } catch { return []; }
        return dirs.filter((d) => { try { return statSync(join(profilesRoot, d)).isDirectory(); } catch { return false; } })
          .map((name) => {
            const dir = join(profilesRoot, name);
            let lastUsed = 0; try { lastUsed = statSync(dir).mtimeMs; } catch { /* */ }
            const sessions = recordStore.sessionsUsingProfile(name);
            // site = host of the most-recent using-session's start url (best-effort)
            let site: string | null = null;
            for (const sid of sessions) {
              const u = recordStore.startUrl(sid); if (u) { try { site = new URL(u).host; break; } catch { /* */ } }
            }
            const status = site ? statusCache.get(name + '\x00' + site) : undefined;
            return { name, site, sessions: sessions.length, sizeMb: dirSizeMb(dir), lastUsed, open: busy === 'relogin-' + name, ...(status ? { status } : {}) };
          }).sort((a, b) => b.lastUsed - a.lastUsed);
      },
      profileNew: (name: string) => {
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return { ok: false as const, error: 'name must be letters/numbers/-._' };
        const dir = profileDir(name);
        if (existsSync2(dir)) return { ok: false as const, error: 'profile "' + name + '" already exists' };
        try { mkdirSync(dir, { recursive: true }); dlog('profile created: ' + name); emit('sessions'); return { ok: true as const }; }
        catch (e) { return { ok: false as const, error: String(e) }; }
      },
      profileOpen: async (name: string) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return { ok: false as const, error: 'bad profile name' };
        const dir = profileDir(name);
        try { mkdirSync(dir, { recursive: true }); } catch { /* */ }   // new profile: create on first login
        prepProfile(dir);   // reap any orphan holding the lock + clear stale Singleton*
        const winId = 'relogin-' + name;
        busy = winId;
        // re-login window: open the profile headed at the site of a session that uses
        // it (or blank) so the human can refresh an expired Cloudflare/2FA login. NOT
        // recording — closes on window close; state persists back to the profile dir.
        let startUrl = 'about:blank';
        for (const sid of recordStore.sessionsUsingProfile(name)) { const u = recordStore.startUrl(sid); if (u) { startUrl = u; break; } }
        try {
          const adapter = new PlaywrightAdapter(winId, undefined, undefined, { headed: true, persistent: true, profile: dir });
          activeAdapter = adapter;
          await adapter.open(startUrl);
          if (startUrl !== 'about:blank') { try { await adapter.goto(startUrl); } catch { /* */ } }   // past the restored tab
          dlog('re-login window opened for profile ' + name + ' — log in by hand, then close the window');
          emit('sessions');
          void (async () => {
            const { listSessions: listPw } = await import('./playwright/sessions.js');
            let pid: number | undefined;
            try { pid = (await listPw(Date.now())).find((x) => x.name === winId)?.pid; } catch { /* */ }
            const alive = () => { if (pid === undefined) return true; try { return execSync('ps -axo ppid=,comm= | awk \'$1==' + pid + '\'', { encoding: 'utf8' }).toLowerCase().includes('chrom'); } catch { return true; } };
            while (alive()) { await new Promise((r) => setTimeout(r, 1000)); if (busy !== winId) break; }
          })().finally(() => { busy = null; activeAdapter = null; dlog('re-login window closed: ' + name); emit('sessions'); });
          return { ok: true as const };
        } catch (e) { busy = null; return { ok: false as const, error: String(e) }; }
      },
      profileRename: (from: string, to: string) => {
        const bad = (n: string) => !/^[\w.-]+$/.test(n) || n === '.' || n === '..';
        if (bad(from) || bad(to)) return { ok: false as const, error: 'names must be letters/numbers/-._' };
        if (!existsSync2(profileDir(from))) return { ok: false as const, error: 'no profile "' + from + '"' };
        if (existsSync2(profileDir(to))) return { ok: false as const, error: '"' + to + '" already exists' };
        try {
          renameSync(profileDir(from), profileDir(to));
          recordStore.renameProfileRefs(from, to);
          dlog('profile renamed: ' + from + ' → ' + to); emit('sessions');
          return { ok: true as const };
        } catch (e) { return { ok: false as const, error: String(e) }; }
      },
      profileDelete: (name: string) => {
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return { ok: false };
        try { rmSync(profileDir(name), { recursive: true, force: true }); dlog('profile deleted (logged out): ' + name); emit('sessions'); return { ok: true }; }
        catch { return { ok: false }; }
      },
      // Status chip engine (Task C item 1) — the SAME flow as `dev profile-status`
      // (Task A), reused rather than duplicated: one polite headless load of the
      // site's map homeUrl, settle, classifyAuthLanding against the site's own
      // fingerprints. Cached per (profile,site) so the tab can show a last-checked
      // time without re-checking on every render.
      profileStatus: async (name: string, site: string) => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return { ok: false as const, error: 'bad profile name' };
        const node = store.getNode(site);
        const url = node?.homeUrl;
        if (!url) return { ok: false as const, error: 'no map for site "' + site + '" yet (no homeUrl)' };
        const dir = profileDir(name);
        try { mkdirSync(dir, { recursive: true }); } catch { /* */ }
        prepProfile(dir);
        const winId = 'pchk-' + name;
        busy = winId;
        const session = 'pchk-' + Math.random().toString(36).slice(2, 6);
        const { settleSnapshot } = await import('./router/browse.js');
        const { classifyAuthLanding } = await import('./router/auth-status.js');
        const adapter = new PlaywrightAdapter(session, undefined, undefined, { headed: false, persistent: true, profile: dir });
        try {
          await adapter.open(url);
          const landedUrl = await adapter.currentUrl();
          const snapshot = await settleSnapshot(() => adapter.snapshot());
          const states = store.statesForNode(site);
          const { auth, loginUrl } = classifyAuthLanding(landedUrl, snapshot, site, states);
          const checkedAt = new Date().toISOString();
          statusCache.set(name + '\x00' + site, { auth, ...(loginUrl ? { loginUrl } : {}), checkedAt });
          emit('sessions');
          return { ok: true as const, auth, ...(loginUrl ? { loginUrl } : {}), checkedAt };
        } catch (e) { return { ok: false as const, error: String(e) }; }
        finally { await adapter.close().catch(() => {}); busy = null; }
      },
      // Reset profile (Task C item 4): per-origin cookie clearing was investigated —
      // playwright-cli's cookie-clear/cookie-delete are process-wide (no --domain
      // filter, unlike cookie-list's read-only filter), so deleting a same-named
      // cookie risks wiping an unrelated site sharing this profile. Not cleanly
      // reachable → recreate the profile dir in place instead (same name, empty):
      // honest "log in with a different account", logs out every site in it.
      profileReset: (name: string) => {
        if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return { ok: false as const, error: 'bad profile name' };
        const dir = profileDir(name);
        if (busy === 'relogin-' + name) return { ok: false as const, error: 'close the login window first' };
        try {
          rmSync(dir, { recursive: true, force: true });
          mkdirSync(dir, { recursive: true });
          for (const key of statusCache.keys()) { if (key.startsWith(name + '\x00')) statusCache.delete(key); }
          dlog('profile reset (logged out of all sites): ' + name); emit('sessions');
          return { ok: true as const };
        } catch (e) { return { ok: false as const, error: String(e) }; }
      },
      events: (id: string) => {
        const evs = recordStore.events(id);
        return { events: evs, coverage: coverage(evs) };
      },
      replay: async (id: string, mode: 'steps' | 'ledger' = 'steps') => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        if (mode === 'ledger') {
          const events = recordStore.events(id);
          if (!events.length) return { ok: false as const, error: 'no ledger — recorded before the ledger existed; use steps replay' };
          const site = (() => { try { return new URL(String((events[0].descriptor as Record<string, unknown>).url ?? (events[0].descriptor as Record<string, unknown>).fromUrl)).host; } catch { return ''; } })();
          const label = (e: (typeof events)[number]) => {
            const d = e.descriptor as Record<string, unknown>;
            return String(d.name ?? d.ariaLabel ?? d.leafText ?? d.placeholder ?? e.kind);
          };
          busy = 'replay:' + id;
          const ctl = new ReplayController(id, events.map((e) => ({ seq: e.seq, label: label(e) })));
          activeCtl = ctl;
          const adapter = new PlaywrightAdapter('replay-' + id, undefined, undefined, { headed: true });
          void runLedgerReplay(events, ctl, { adapter, creds, site, shotsDir: join(shotsRoot, id) })
            .catch(() => { /* engine already recorded state.error; never let this reject */ })
            .finally(() => { busy = null; });
          return { ok: true as const };
        }
        const effects = recordStore.actionEffects(id);
        if (!effects.length) return { ok: false as const, error: 'empty recording' };
        busy = 'replay:' + id;
        const site = (() => { try { return new URL(effects[0].fromUrl).host; } catch { return ''; } })();
        const ctl = new ReplayController(id, effects.map((e) => ({ seq: e.seq, label: e.action?.name ?? (e.navigated ? 'jump' : 'observe') })));
        activeCtl = ctl;
        const adapter = new PlaywrightAdapter('replay-' + id, undefined, undefined, { headed: true });
        void runReplay(effects, ctl, { adapter, creds, site, shotsDir: join(shotsRoot, id) })
          .catch(() => { /* engine already recorded state.error; never let this reject */ })
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
    // Open a browser tab ONLY when asked (--open). Default is quiet: auto-opening a
    // tab on every start floods the user's Chrome — the URL is printed to click.
    if (args.open && process.platform === 'darwin') {
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
  if (args.cmd === 'test') {
    const { readFileSync } = await import('node:fs');
    const { MapStore } = await import('./mapstore/store.js');
    const { parseSuite, runSuite, SuiteConfigError } = await import('./router/suite.js');
    const { makeLiveWalkBrowser } = await import('./router/walk-live.js');
    const { PlaywrightAdapter, resolveProfile } = await import('./playwright/adapter.js');
    const { ensureCanOpen } = await import('./playwright/sessions.js');
    const { settleSnapshot } = await import('./router/browse.js');
    const { classifyAuthLanding } = await import('./router/auth-status.js');
    const { CredStore } = await import('./creds.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    if (!args.suite) {
      console.log(JSON.stringify({ status: 'error', hint: 'usage: webnav test --suite <file.suite.json> [--headless]' }, null, 2));
      process.exitCode = 2; return;
    }
    let suite;
    try {
      suite = parseSuite(JSON.parse(readFileSync(args.suite, 'utf8')));
    } catch (e) {
      const hint = e instanceof SuiteConfigError ? e.message : 'could not read/parse suite: ' + String((e as Error).message);
      console.log(JSON.stringify({ status: 'error', hint }, null, 2));
      process.exitCode = 2; return;
    }
    const store = new MapStore(dbPath());
    const node = store.getNode(suite.site);
    if (!node) {
      console.log(JSON.stringify({ status: 'error', hint: `no map for site '${suite.site}' — map it first (dev record-start) then re-run` }, null, 2));
      process.exitCode = 2; return;
    }
    const states = store.statesForNode(suite.site);
    // A suite always runs headless (a release check should never pop windows; the
    // suite opens a fresh browser per case). --headless is documented as the
    // recommended flag but the runner enforces headless regardless of the default.
    const profilesRoot = join(homedir(), '.webnav', 'profiles');
    const profileDir = suite.profile ? resolveProfile(suite.profile, profilesRoot) : undefined;
    const bopts: BrowserOpts = { headed: false, ...(profileDir ? { persistent: true, profile: profileDir } : {}) };
    const siteCreds = new CredStore().get(suite.site);
    const progress: string[] = [];
    const shortId = () => 'tst-' + Math.random().toString(36).slice(2, 6);
    const res = await runSuite(suite, {
      store, states,
      onProgress: (l) => { progress.push(l); process.stderr.write(l + '\n'); },
      // AUTH PRE-FLIGHT (once, before case 1): the SAME check as `dev profile-status`
      // — one headless load of the site homeUrl, settle, classify against the map's
      // own fingerprints (the oracle). needs-login fails the whole run fast.
      preflight: async () => {
        const session = shortId();
        const adapter = new PlaywrightAdapter(session, undefined, undefined, bopts);
        try {
          await adapter.open(node.homeUrl ?? 'about:blank');
          const landedUrl = await adapter.currentUrl();
          const snapshot = await settleSnapshot(() => adapter.snapshot());
          const { auth, loginUrl } = classifyAuthLanding(landedUrl, snapshot, suite.site, states);
          return { auth, loginUrl };
        } finally { await adapter.close().catch(() => {}); }
      },
      // A FRESH browser session per case (the CF first-load pattern), reaped after.
      openCase: async (startUrl: string) => {
        const session = shortId();
        const gate = await ensureCanOpen(session, []);
        if (!gate.ok) throw new Error(gate.reason);
        const adapter = new PlaywrightAdapter(session, undefined, undefined, bopts);
        await adapter.open(startUrl);
        const browser = makeLiveWalkBrowser(adapter, { ...siteCreds }, bopts, session);
        return { browser, close: async () => { await adapter.close().catch(() => {}); } };
      },
    });
    console.log(JSON.stringify(res, null, 2));
    process.exitCode = res.status === 'ok' ? 0 : 3;
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
    const startState = store.getState(args.start)!;
    const states = store.statesForNode(startState.nodeId ?? '');
    // --observe <label>: resolved against the goal's node like --start/--goal (a
    // state id, or its bare semanticName) — same scope, so `--observe inventory`
    // finds `www.saucedemo.com:inventory` without repeating the site prefix. A
    // label that resolves to nothing errors HERE, loudly, BEFORE any browser
    // opens — a silent drop would return a normal done with zero checkpoints and
    // no signal that the typo'd observe never armed (same posture as a bad
    // --start/--goal).
    const observe: string[] = [];
    for (const label of args.observe) {
      const id = resolveObserveLabel(states, label);
      if (!id) {
        console.log(JSON.stringify({ status: 'error',
          hint: 'unknown --observe state "' + label + '" — known states for ' + (startState.nodeId ?? args.start)
            + ': ' + states.map((s) => s.semanticName).join(', ') }, null, 2));
        process.exitCode = 2; return;
      }
      observe.push(id);
    }
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
    await adapter.open(startState.urlPattern || 'about:blank');
    // Inputs = stored creds for this site (if any) overlaid with any --input flags
    // (flags win). Lets `walk` run without re-typing credentials each time, while
    // a one-off --input still overrides. Creds live in ~/.webnav/credentials.json,
    // never in the map.
    const { CredStore } = await import('./creds.js');
    const siteCreds = startState.nodeId ? new CredStore().get(startState.nodeId) : {};
    const inputs = { ...siteCreds, ...args.inputs };
    // Pass bopts through so the walk can retry a detected SSO wall in a FRESH
    // session under the SAME profile (design item 2) — omitted (no retry
    // capability) when the walk isn't running under a named profile.
    const browser = makeLiveWalkBrowser(adapter, inputs, bopts, browserSession);
    const res = await walkRoute({ goalName: 'walk:' + args.goal, startStateId: args.start, goalStateId: args.goal, store, states, browser, path, profile: args.browser.profile, observe, observeDynamic: args.observeDynamic });
    // needs-auth: the wall persisted through the fresh-session retry (or no retry was
    // possible). Fail-fast, NOT a resumable pause — a stale login can't be fixed by
    // replaying the same route, so leaving a paused walk-session + a live daemon
    // around would just be a dangling browser nothing resumes. Close it here; the
    // consumer contract is: the agent tells the user to re-login, then re-runs `walk`.
    if (res.status === 'needs-auth') {
      await browser.close?.().catch(() => {});
      console.log(JSON.stringify(res, null, 2));
      process.exitCode = 2;
      return;
    }
    if (res.status === 'needs-navigation' || res.status === 'needs-classification' || res.status === 'checkpoint') {
      const sessions = new WalkSessionStore();
      // A wall retry may have rotated to a brand-new browser session — read it
      // back from the browser (not the original `browserSession` var) so a paused
      // session id the agent resumes against actually points at the live browser.
      const liveSession = browser.sessionId?.() || browserSession;
      const id = sessions.create({ startState: args.start, goalState: args.goal, path, browserSession: liveSession, profile: bopts.profile, observe, observeDynamic: args.observeDynamic });
      // pos points at the state the walk paused ON, so resume restarts there.
      const pausedAt = (res as any).at;
      if (typeof pausedAt === 'number') sessions.advance(id, pausedAt);
      // Fire-once tracking: a checkpoint pause adds its OWN state to `observed` so a
      // resume doesn't re-fire it; pauseKind gates walk-resume's `--continue` to only
      // ever answer a checkpoint (never a needs-navigation/needs-classification pause).
      const observedNow = res.status === 'checkpoint' ? [res.state] : [];
      sessions.setPause(id, observedNow, res.status);
      // Expose browserSession so the agent can act on the LIVE paused browser
      // (e.g. fire an in-page affordance) via `use <verb> --session <browserSession>`
      // before calling walk-resume.
      console.log(JSON.stringify({ ...res, session: id, browserSession: liveSession }, null, 2));
    } else {
      if (browser.close) await browser.close().catch(() => {});
      else await adapter.close().catch(() => {});
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
    // --continue only ever answers a checkpoint pause — --ref/--classify answer the
    // OTHER pause kinds. Reject early with a hint rather than silently misapplying it
    // (walkRoute would otherwise just fall through to a normal step, masking the mistake).
    if (args.continue && w.pauseKind !== 'checkpoint') {
      console.log(JSON.stringify({ status: 'failed',
        reason: '--continue answers a checkpoint pause, but this session paused on ' + (w.pauseKind ?? 'unknown')
          + ' — use --ref (needs-navigation) or --classify (needs-classification) instead' }, null, 2));
      process.exitCode = 2; return;
    }
    const answer = args.continue ? { kind: 'continue' as const }
      : args.ref ? { kind: 'ref' as const, ref: args.ref }
      : args.classify ? { kind: 'classify' as const, verdict: args.classify as 'safe' | 'commit' }
      : undefined;
    if (!answer) { console.log(JSON.stringify({ status: 'failed', reason: 'supply --ref, --classify, or --continue' }, null, 2)); process.exitCode = 2; return; }
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
    // w.profile is the ALREADY-RESOLVED profile dir the original `walk` stored —
    // reusing it here (walk-resume takes no --profile of its own) is what lets a
    // wall retry reopen under the SAME profile mid-resume.
    const rbopts = w.profile ? { profile: w.profile } : undefined;
    const browser = makeLiveWalkBrowser(adapter, inputs, rbopts, w.browserSession);
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + w.goalState, startStateId: resumeFrom, goalStateId: w.goalState, store, states, browser, path: w.path, answer, profile: w.profile,
      observe: w.observe, observeDynamic: w.observeDynamic, observed: w.observed });
    if (res.status === 'needs-auth') {
      sessions.close(args.session);
      await (browser.close ? browser.close() : adapter.close()).catch(() => {});
      console.log(JSON.stringify(res, null, 2));
      process.exitCode = 2;
    } else if (res.status === 'needs-navigation' || res.status === 'needs-classification' || res.status === 'checkpoint') {
      // walkRoute's `at` is RELATIVE to resumeFrom (it starts each call at 0), but
      // the session `pos` is ABSOLUTE over the full path. resumeFrom sits at w.pos,
      // so absolute = w.pos + at. A single resume can traverse several states before
      // halting, so this keeps the session synced (the desync bug that restarted the
      // next resume at the wrong step).
      const relAt = (res as any).at;
      const absPos = typeof relAt === 'number' ? w.pos + relAt : w.pos + 1;
      sessions.advance(args.session, absPos);
      // A wall retry may have rotated to a brand-new browser session mid-resume;
      // repoint the (stable) session_id at it so the NEXT walk-resume reattaches
      // to the live daemon instead of the one that was just closed.
      const liveSession = browser.sessionId?.() || w.browserSession;
      if (liveSession !== w.browserSession) sessions.rebrowser(args.session, liveSession);
      // Fire-once tracking carries forward: append this checkpoint's state (if any)
      // to the ALREADY-observed set from the original walk / prior resumes.
      const observedNow = res.status === 'checkpoint' ? [...w.observed, res.state] : w.observed;
      sessions.setPause(args.session, observedNow, res.status);
      console.log(JSON.stringify({ ...res, session: args.session, browserSession: liveSession }, null, 2));
    } else {
      sessions.close(args.session);
      await (browser.close ? browser.close() : adapter.close()).catch(() => {});
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
    const { homedir: homedir2 } = await import('node:os');
    const { join: join2 } = await import('node:path');
    const profilesRoot2 = join2(homedir2(), '.webnav', 'profiles');
    // Agent path parity with the dashboard: a bare --profile NAME → the shared
    // profiles dir (+ prepProfile to clear an orphan lock) so an agent runs under
    // the same login a human would. resolveProfile leaves absolute paths untouched.
    const nbrowser = { ...args.browser };
    if (nbrowser.profile) {
      const { resolveProfile } = await import('./playwright/adapter.js');
      const { prepProfile } = await import('./playwright/profile-lock.js');
      nbrowser.profile = resolveProfile(nbrowser.profile, profilesRoot2);
      try { (await import('node:fs')).mkdirSync(nbrowser.profile, { recursive: true }); } catch { /* */ }
      prepProfile(nbrowser.profile);
    }
    const adapter = new PlaywrightAdapter(args.session, undefined, undefined, nbrowser);
    try {
      // `open` creates the session if new AND navigates; it also works to
      // re-navigate an existing session (whereas `goto` requires the session to
      // already exist, which fails on the first navigate of a fresh session).
      await adapter.open(args.url);
      const rec = new RecordStore(dbPath());
      // Auto-start recording so an agent session is a first-class, dashboard-visible
      // recording (steps + video) without a separate record-start. Video capture
      // starts on the first navigate and is stopped by `dev record-stop`.
      const fresh = !rec.isActive(args.session);
      if (fresh) {
        rec.start(args.session);
        const profName = nbrowser.profile ? nbrowser.profile.split('/').pop() : null;
        if (profName) rec.setProfile(args.session, profName);
        rec.setStartUrl(args.session, args.url);
        // NOTE: no video here. playwright-cli video capture does NOT survive across
        // separate CLI processes (proven: video-stop in a later process → "No videos
        // were recorded"). Agent video needs a long-lived process owning the session
        // (like the human live-loop) — tracked as a follow-up, NOT faked here.
      }
      // Settle + record via the shared seam (same gate as agent-session/runActionRecorded):
      // a client-side redirect otherwise records a pre-render shell as the page, and the
      // requestedUrl (what the agent ASKED for) is the draft's redirect-alias evidence.
      const { recordNavigateEffect, classifyNavigateWall } = await import('./router/browse.js');
      const { toUrl, toSnapshot } = await recordNavigateEffect(args.url, args.session, rec, adapter);
      // Wall check (design item 2, NO auto-retry here — a recording captures what
      // actually happened, judgment-free). Classify against the target site's own
      // map states (the map is the oracle, same as profile-status/walk) and surface
      // authWall so the driving agent knows immediately instead of guessing from a
      // bare snapshot.
      let site: string | null = null;
      try { site = new URL(args.url).host; } catch { /* unparseable url */ }
      const { MapStore: MapStoreForWall } = await import('./mapstore/store.js');
      const wallStates = site ? new MapStoreForWall(dbPath()).statesForNode(site) : [];
      const wall = classifyNavigateWall(args.url, toUrl, toSnapshot, wallStates);
      console.log(JSON.stringify({
        status: 'done', url: toUrl, recorded: true,
        ...(wall.authWall ? { authWall: true, loginUrl: wall.loginUrl } : {}),
      }, null, 2));
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

// --observe <label>: resolved the same way --start/--goal already are — a full
// state id, or its bare semanticName within the node's states (so `--observe
// inventory` finds `www.saucedemo.com:inventory` without repeating the prefix).
// null = unknown label; the walk handler errors on it (exit 2 + a hint listing
// the node's known states) BEFORE opening a browser — same loud posture as a
// bad --start/--goal, so a typo never silently disarms the checkpoint.
export function resolveObserveLabel(states: State[], label: string): string | null {
  const byId = states.find((s) => s.id === label);
  if (byId) return byId.id;
  const byName = states.find((s) => s.semanticName === label);
  return byName ? byName.id : null;
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
