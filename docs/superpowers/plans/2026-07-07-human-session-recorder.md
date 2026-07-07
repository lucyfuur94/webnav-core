# Human-Session Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Chrome extension turn real human browsing into webnav `ActionEffect`s that flow through the existing `graph-analyse`/`draft`/`walk` pipeline unchanged — replacing the LLM-agent-driven map-building bottleneck with real usage.

**Architecture:** Two producers, one sink. A new Chrome MV3 extension (`webnav-recorder/`, isolated package) captures per-interaction a11y snapshots + a synthetic-ref-marked clicked element, POSTs `ActionEffect[]` to a new `webnav dev ingest` localhost receiver, which reconstructs `elementFp` + `diff` server-side (reusing tested code: `recoverFingerprint`, `diffSnapshots`) and writes via `RecordStore.appendActionEffect`. No existing file's behavior changes.

**Tech Stack:** TypeScript (strict), Node, vitest, better-sqlite3, Chrome MV3 (vanilla JS/TS content+background+popup — no framework).

## Global Constraints

- **Zero LLM** in webnav (principle #5a). The recorder captures/serializes only; no reasoning.
- **Uniform JSON stdout** for every CLI verb; diagnostics to stderr; exit codes 0 ok / 2 error / 3 empty (per CLAUDE.md CLI ergonomics). `dev ingest` obeys this.
- **The extension's ONLY contract with webnav is `ActionEffect[]` over HTTP.** Nothing downstream changes.
- **Never record typed secret values.** Password fields and `autocomplete=cc-*`/PII inputs: capture the field's fingerprint, never the characters typed.
- **`webnav-recorder/` is an isolated package** (own `package.json`) — NOT a root dependency (like `web/` was).
- **Snapshot format contract** = whatever `src/playwright/snapshot.ts::parseSnapshot` reads: one node per line `<role> "<name>" [ref=eN]`, indentation = depth, `/url:` line immediately after a node = that node's link, a line survives only with a quoted name OR a bracketed attr (so icon-only nodes MUST carry `[ref=eN]`).
- **Commit after every task** (frequent commits). Run `npx tsc --noEmit` + relevant vitest before each commit.

---

## File Structure

- **Create** `src/recorder/snapshot-dom.ts` — pure a11y-tree → parity-snapshot serializer + the shared `SerializableNode` input type. In-repo (test oracle); the extension runs a twin.
- **Create** `tests/recorder/snapshot-dom.test.ts` — parity test vs `parseSnapshot`.
- **Create** `src/recorder/ingest.ts` — the ingest logic: reconstruct `ActionEffect` (server-side `elementFp` + `diff`) and write to `RecordStore`; plus the localhost HTTP receiver.
- **Create** `tests/recorder/ingest.test.ts` — round-trip: raw POST body → RecordStore rows → walkable `draftFromEffects`.
- **Modify** `src/cli-spec.ts` — register the `dev ingest` verb (help/flags).
- **Modify** `src/cli.ts` — parse + dispatch `ingest`.
- **Create** `webnav-recorder/` — the Chrome extension (manifest, content, background, popup). Isolated package; smoke-tested manually (not in vitest).

---

## Task 1: The a11y-tree → parity-snapshot serializer

**Files:**
- Create: `src/recorder/snapshot-dom.ts`
- Test: `tests/recorder/snapshot-dom.test.ts`

**Interfaces:**
- Consumes: `parseSnapshot`, `SnapNode` from `src/playwright/snapshot.js` (test oracle only).
- Produces:
  - `interface SerializableNode { role: string; name: string | null; url?: string | null; children?: SerializableNode[] }`
  - `function serializeSnapshot(root: SerializableNode): string` — emits parity text with sequential synthetic refs `e1,e2,…` assigned in pre-order to EVERY node, one node per line, 2-space indent per depth level, and a `/url:` line after any node with a `url`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/recorder/snapshot-dom.test.ts
import { describe, it, expect } from 'vitest';
import { serializeSnapshot, type SerializableNode } from '../../src/recorder/snapshot-dom.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

describe('serializeSnapshot → parseSnapshot parity', () => {
  it('round-trips roles, names, refs, urls, and depth', () => {
    const root: SerializableNode = {
      role: 'RootWebArea', name: 'Login',
      children: [
        { role: 'textbox', name: 'Username' },
        { role: 'link', name: 'Learn more', url: 'https://x.test/more' },
        { role: 'button', name: null }, // icon-only: no name → must still parse via its ref
      ],
    };
    const nodes = parseSnapshot(serializeSnapshot(root));
    // every input node survives (icon-only included) → 4 nodes
    expect(nodes.length).toBe(4);
    const byRole = (r: string) => nodes.find((n) => n.role === r)!;
    expect(byRole('textbox').name).toBe('Username');
    expect(byRole('link').url).toBe('https://x.test/more');
    // synthetic refs are assigned to every node, sequential from e1
    expect(nodes.map((n) => n.ref)).toEqual(['e1', 'e2', 'e3', 'e4']);
    // depth increases for children of the root
    expect(byRole('RootWebArea').depth).toBeLessThan(byRole('textbox').depth);
  });

  it('the icon-only (nameless) button is recoverable by its ref', () => {
    const root: SerializableNode = { role: 'RootWebArea', name: 'X',
      children: [{ role: 'button', name: null }] };
    const nodes = parseSnapshot(serializeSnapshot(root));
    const btn = nodes.find((n) => n.role === 'button')!;
    expect(btn).toBeDefined();
    expect(btn.ref).toBe('e2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recorder/snapshot-dom.test.ts`
Expected: FAIL — cannot find module `snapshot-dom.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/recorder/snapshot-dom.ts
// Serialize an accessibility tree to the playwright-parity snapshot text that
// src/playwright/snapshot.ts::parseSnapshot reads. Pure + deterministic; the
// in-repo test oracle for the extension's browser-side twin.

export interface SerializableNode {
  role: string;
  name: string | null;
  url?: string | null;
  children?: SerializableNode[];
}

// Assign a sequential synthetic ref (e1, e2, …) to EVERY node in pre-order, so
// even nameless icon nodes carry a bracketed attr and survive parseSnapshot
// (which drops a line that has neither a quoted name nor a [attr]).
export function serializeSnapshot(root: SerializableNode): string {
  const lines: string[] = [];
  let counter = 0;
  const walk = (node: SerializableNode, depth: number): void => {
    const ref = `e${++counter}`;
    const indent = '  '.repeat(depth);
    const namePart = node.name !== null ? ` "${node.name}"` : '';
    lines.push(`${indent}${node.role}${namePart} [ref=${ref}]`);
    if (node.url) lines.push(`${indent}  /url: ${node.url}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recorder/snapshot-dom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recorder/snapshot-dom.ts tests/recorder/snapshot-dom.test.ts
git commit -m "feat(recorder): a11y-tree → parity-snapshot serializer (test oracle)"
```

---

## Task 2: Ingest reconstruction — build a stored ActionEffect from a raw browser step

**Files:**
- Create: `src/recorder/ingest.ts`
- Test: `tests/recorder/ingest.test.ts`

**Interfaces:**
- Consumes:
  - `serializeSnapshot`/`SerializableNode` from `src/recorder/snapshot-dom.js` (test fixtures only).
  - `parseSnapshot` from `src/playwright/snapshot.js`.
  - `recoverFingerprint(nodes, ref)` from `src/playwright/fingerprint.js` → `ElementFingerprint | null`.
  - `diffSnapshots(before: SnapNode[], after: SnapNode[])` from `src/explorer/diff.js` → `SnapshotDiff`.
  - `RecordStore` (`start`, `appendActionEffect`, `stop`, `actionEffects`), `ActionEffect`, `ActionRef` from `src/mapstore/record.js`.
  - `draftFromEffects` from `src/explorer/draft.js` (test only).
- Produces:
  - `interface RawStep { fromUrl: string; fromSnapshot: string; toUrl: string; toSnapshot: string; navigated: boolean; ref: string | null }` — one recorded interaction as the extension sends it (snapshots are already parity strings; `ref` is the synthetic ref of the clicked node, or null for a pure navigation).
  - `interface IngestBody { sessionId: string; steps: RawStep[] }`
  - `function reconstructEffect(step: RawStep): ActionEffect` — server-side: parse `fromSnapshot`, build `ActionRef` via `recoverFingerprint`, compute `diff` via `diffSnapshots`.
  - `function ingest(body: IngestBody, store: RecordStore): number` — start session, append every reconstructed effect, stop; returns count appended.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/recorder/ingest.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { ingest, type IngestBody } from '../../src/recorder/ingest.js';
import { serializeSnapshot, type SerializableNode } from '../../src/recorder/snapshot-dom.js';
import { draftFromEffects } from '../../src/explorer/draft.js';

const page = (name: string, extra: SerializableNode[] = []): SerializableNode => ({
  role: 'RootWebArea', name,
  children: [{ role: 'button', name: 'Login' }, ...extra],
});

describe('ingest', () => {
  it('writes reconstructed ActionEffects that draftFromEffects can fold', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const from = serializeSnapshot(page('Login'));
    const to = serializeSnapshot(page('Inventory', [{ role: 'link', name: 'Cart', url: 'https://s.test/cart' }]));
    const body: IngestBody = {
      sessionId: 'human-1',
      steps: [{
        fromUrl: 'https://s.test/login', fromSnapshot: from,
        toUrl: 'https://s.test/inventory', toSnapshot: to,
        navigated: true,
        ref: 'e2', // the "Login" button in the from-snapshot (e1=root, e2=button)
      }],
    };
    const n = ingest(body, store);
    expect(n).toBe(1);

    const effects = store.actionEffects('human-1');
    expect(effects.length).toBe(1);
    // server-side reconstruction filled the fingerprint from the synthetic ref
    expect(effects[0].action?.elementFp?.role).toBe('button');
    expect(effects[0].action?.elementFp?.name).toBe('Login');
    // server-side diff is present (not the empty placeholder)
    expect(effects[0].diff).toBeTruthy();

    // the whole point: human sessions are walkable like agent sessions
    const draft = draftFromEffects(effects);
    expect(draft.states.length).toBeGreaterThan(0);
  });

  it('a pure navigation step (ref=null) still ingests', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestBody = {
      sessionId: 'human-2',
      steps: [{
        fromUrl: 'https://s.test/a', fromSnapshot: serializeSnapshot(page('A')),
        toUrl: 'https://s.test/b', toSnapshot: serializeSnapshot(page('B')),
        navigated: true, ref: null,
      }],
    };
    expect(ingest(body, store)).toBe(1);
    expect(store.actionEffects('human-2')[0].action).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recorder/ingest.test.ts`
Expected: FAIL — cannot find module `ingest.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/recorder/ingest.ts
// Server-side ingest: turn raw recorded browser steps into stored ActionEffects.
// The extension stays dumb — fingerprint + diff are reconstructed here from the
// snapshots, reusing tested code (recoverFingerprint, diffSnapshots).

import { parseSnapshot } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import { diffSnapshots } from '../explorer/diff.js';
import type { ActionEffect, ActionRef } from '../mapstore/record.js';
import { RecordStore } from '../mapstore/record.js';

export interface RawStep {
  fromUrl: string; fromSnapshot: string;
  toUrl: string; toSnapshot: string;
  navigated: boolean;
  ref: string | null;   // synthetic ref of the clicked node in fromSnapshot, or null for a pure nav
}
export interface IngestBody { sessionId: string; steps: RawStep[] }

export function reconstructEffect(step: RawStep): ActionEffect {
  const fromNodes = parseSnapshot(step.fromSnapshot);
  const toNodes = parseSnapshot(step.toSnapshot);
  let action: ActionRef | null = null;
  if (step.ref) {
    const node = fromNodes.find((n) => n.ref === step.ref) ?? null;
    action = {
      role: node?.role ?? '', name: node?.name ?? null, ref: step.ref,
      elementFp: recoverFingerprint(fromNodes, step.ref),
    };
  }
  return {
    fromUrl: step.fromUrl, fromSnapshot: step.fromSnapshot,
    action,
    toUrl: step.toUrl, toSnapshot: step.toSnapshot,
    navigated: step.navigated,
    diff: diffSnapshots(fromNodes, toNodes),
  };
}

export function ingest(body: IngestBody, store: RecordStore): number {
  store.start(body.sessionId);
  let n = 0;
  for (const step of body.steps) { store.appendActionEffect(body.sessionId, reconstructEffect(step)); n++; }
  store.stop(body.sessionId);
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recorder/ingest.test.ts`
Expected: PASS (2 tests). If `draft.states` is named differently, adjust the assertion to the actual `DraftGraph` shape (read `src/explorer/draft.ts` return type).

- [ ] **Step 5: Commit**

```bash
git add src/recorder/ingest.ts tests/recorder/ingest.test.ts
git commit -m "feat(recorder): server-side ingest — reconstruct ActionEffect (fp+diff) from raw step"
```

---

## Task 3: The `dev ingest` CLI verb + localhost receiver

**Files:**
- Modify: `src/recorder/ingest.ts` (add `serveIngest`)
- Modify: `src/cli-spec.ts` (register verb)
- Modify: `src/cli.ts` (parse + dispatch)
- Test: `tests/recorder/ingest.test.ts` (add a receiver round-trip over HTTP)

**Interfaces:**
- Consumes: `ingest`, `IngestBody` (Task 2); `http` (node stdlib); `dbPath` from `src/paths.js`.
- Produces: `function serveIngest(port: number, store: RecordStore): http.Server` — a localhost-only server; `POST /ingest` with an `IngestBody` JSON → `{ ok: true, appended: n }` (200) or `{ ok: false, error }` (400). CORS: allow the extension origin (`Access-Control-Allow-Origin: *` is acceptable — localhost-only, no secrets in transit beyond the map).

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/recorder/ingest.test.ts
import { serveIngest } from '../../src/recorder/ingest.js';

it('serveIngest accepts a POST and appends', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  const server = serveIngest(0, store); // port 0 = OS-assigned
  await new Promise((r) => server.on('listening', r));
  const port = (server.address() as any).port;
  const body: IngestBody = {
    sessionId: 'http-1',
    steps: [{
      fromUrl: 'https://s.test/a', fromSnapshot: serializeSnapshot(page('A')),
      toUrl: 'https://s.test/b', toSnapshot: serializeSnapshot(page('B')),
      navigated: true, ref: 'e2',
    }],
  };
  const res = await fetch(`http://127.0.0.1:${port}/ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  server.close();
  expect(json.ok).toBe(true);
  expect(json.appended).toBe(1);
  expect(store.actionEffects('http-1').length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recorder/ingest.test.ts`
Expected: FAIL — `serveIngest` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/recorder/ingest.ts`:

```typescript
import http from 'node:http';

export function serveIngest(port: number, store: RecordStore): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST' || req.url !== '/ingest') { res.writeHead(404).end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw) as IngestBody;
        if (!body.sessionId || !Array.isArray(body.steps)) throw new Error('sessionId and steps[] required');
        const appended = ingest(body, store);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, appended }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recorder/ingest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the verb in `src/cli-spec.ts`**

Find the `dev` verb group (near `record-start`/`record-stop`, ~line 222) and add an entry matching the existing object shape. Copy a neighboring dev verb's structure exactly; the new entry:

```typescript
{
  name: 'ingest',
  summary: 'Run a localhost receiver that turns human-recorded browser sessions into map data.',
  detail: 'Starts an HTTP server on --port (default 7778). The webnav-recorder Chrome extension POSTs recorded steps to POST /ingest; they land in webnav.db as ActionEffects, identical to agent-recorded ones — then use `dev graph-analyse <sessionId> --draft`.',
  flags: [{ name: '--port', takesValue: true, description: 'Localhost port to listen on (default 7778).' }],
  example: 'webnav dev ingest --port 7778',
},
```

- [ ] **Step 6: Parse + dispatch in `src/cli.ts`**

Add to the `Args` union (near the other `dev` cmds, ~line 19):

```typescript
  | { cmd: 'ingest'; port: number }
```

Add to the parser (near the other `graph-*` parse lines, ~line 155):

```typescript
  if (cmd === 'ingest') return { cmd, port: Number(flagValue(rest, '--port') ?? 7778) };
```

Add the dispatch (near the other `dev` handlers, e.g. after `graph-analyse` ~line 357). This is a long-running verb (like `dashboard`/`mcp`) — it does NOT print-and-exit; it prints a ready line to stderr and keeps serving:

```typescript
  if (args.cmd === 'ingest') {
    const { serveIngest } = await import('./recorder/ingest.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const server = serveIngest(args.port, new RecordStore(dbPath()));
    process.stderr.write(`webnav ingest listening on http://127.0.0.1:${args.port}/ingest\n`);
    process.stdout.write(JSON.stringify({ status: 'listening', port: args.port }) + '\n');
    await new Promise(() => {}); // run until killed
    return;
  }
```

- [ ] **Step 7: Verify build + full suite green**

Run: `npx tsc --noEmit && npx vitest run tests/recorder`
Expected: tsc exit 0; all recorder tests PASS.

Run (manual smoke): `webnav dev ingest --port 7778` in one terminal; in another:
`curl -s -XPOST http://127.0.0.1:7778/ingest -H 'content-type: application/json' -d '{"sessionId":"smoke","steps":[]}'`
Expected: `{"ok":true,"appended":0}`.

- [ ] **Step 8: Commit**

```bash
git add src/recorder/ingest.ts src/cli-spec.ts src/cli.ts tests/recorder/ingest.test.ts
git commit -m "feat(cli): dev ingest — localhost receiver for human-recorded sessions"
```

---

## Task 4: The Chrome extension (MV3) — capture, buffer, POST

**Files:**
- Create: `webnav-recorder/package.json` (isolated; name `webnav-recorder`, private:true)
- Create: `webnav-recorder/manifest.json` (MV3)
- Create: `webnav-recorder/serialize.ts` — browser twin of `serializeSnapshot` (or import-shared; see note)
- Create: `webnav-recorder/content.ts` — capture interactions → RawStep
- Create: `webnav-recorder/background.ts` — buffer per tab/session, POST on stop
- Create: `webnav-recorder/popup.html` + `webnav-recorder/popup.ts` — record/stop toggle, session name, ingest URL
- Create: `webnav-recorder/README.md` — load-unpacked instructions

**Interfaces:**
- Consumes: the `RawStep`/`IngestBody` JSON shape from Task 2 (must match exactly).
- Produces: a loadable unpacked extension. No vitest (browser-only); verified by manual smoke.

**Note on the serializer twin:** `serialize.ts` must emit the SAME format as `src/recorder/snapshot-dom.ts::serializeSnapshot`. Keep them in sync by copying the algorithm (it's ~15 lines) and adding a comment in BOTH files pointing at each other. `ponytail:` two copies of a 15-line pure fn is cheaper than a shared-build-target for one function; unify only if a third consumer appears.

- [ ] **Step 1: manifest + package scaffold**

```json
// webnav-recorder/manifest.json
{
  "manifest_version": 3,
  "name": "webnav recorder",
  "version": "0.1.0",
  "description": "Record real browsing into a webnav map (local).",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }],
  "action": { "default_popup": "popup.html" }
}
```

```json
// webnav-recorder/package.json
{ "name": "webnav-recorder", "version": "0.1.0", "private": true,
  "description": "Chrome MV3 extension: record browsing into webnav.",
  "scripts": { "build": "tsc -p tsconfig.json" } }
```

- [ ] **Step 2: the browser serializer twin**

```typescript
// webnav-recorder/serialize.ts
// TWIN of src/recorder/snapshot-dom.ts::serializeSnapshot — MUST stay in sync.
// Walk a captured accessibility tree → the parity snapshot text parseSnapshot reads.
export interface SNode { role: string; name: string | null; url?: string | null; children?: SNode[] }
export function serialize(root: SNode): string {
  const lines: string[] = []; let c = 0;
  const walk = (n: SNode, d: number) => {
    const ref = `e${++c}`, ind = '  '.repeat(d);
    lines.push(`${ind}${n.role}${n.name !== null ? ` "${n.name}"` : ''} [ref=${ref}]`);
    if (n.url) lines.push(`${ind}  /url: ${n.url}`);
    for (const ch of n.children ?? []) walk(ch, d + 1);
  };
  walk(root, 0); return lines.join('\n');
}
// Build an SNode tree from the live DOM. Uses ARIA role + accessible name.
// Secret-field rule: NEVER read .value of password / autocomplete=cc-*/PII inputs.
export function domToSNode(el: Element): SNode {
  const role = el.getAttribute('role') || implicitRole(el);
  const name = accessibleName(el);
  const url = el instanceof HTMLAnchorElement ? el.href : null;
  const children = Array.from(el.children).map(domToSNode);
  return { role, name, url, children };
}
function implicitRole(el: Element): string {
  const t = el.tagName.toLowerCase();
  const map: Record<string, string> = { a: 'link', button: 'button', input: 'textbox',
    h1: 'heading', h2: 'heading', h3: 'heading', nav: 'navigation', main: 'main', body: 'RootWebArea' };
  return map[t] ?? 'generic';
}
function accessibleName(el: Element): string | null {
  const aria = el.getAttribute('aria-label'); if (aria) return aria;
  const txt = (el.textContent || '').trim(); return txt || null;
}
```

- [ ] **Step 3: content script — capture interactions**

```typescript
// webnav-recorder/content.ts
import { serialize, domToSNode, type SNode } from './serialize.js';

let recording = false;
chrome.storage.local.get('recording', (v) => { recording = !!v.recording; });
chrome.storage.onChanged.addListener((ch) => { if (ch.recording) recording = !!ch.recording.newValue; });

function isSecret(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  return el.type === 'password' || /^cc-|cc-number|cc-csc/.test(el.autocomplete || '');
}
function fromSnapshot(): { snap: string; refByEl: Map<Element, string> } {
  // serialize the page and remember which ref maps to which element, so a click
  // can report the synthetic ref of the exact node clicked.
  const refByEl = new Map<Element, string>();
  let c = 0;
  const walk = (el: Element): SNode => {
    const ref = `e${++c}`; refByEl.set(el, ref);
    const role = el.getAttribute('role') || (el.tagName.toLowerCase() === 'body' ? 'RootWebArea' : 'generic');
    const name = el.getAttribute('aria-label') || (el.textContent || '').trim() || null;
    const url = el instanceof HTMLAnchorElement ? el.href : null;
    return { role, name, url, children: Array.from(el.children).map(walk) };
  };
  const tree = walk(document.body);
  return { snap: serialize(tree), refByEl };
}

let pending: { fromUrl: string; snap: string; ref: string | null } | null = null;

document.addEventListener('click', (e) => {
  if (!recording) return;
  const { snap, refByEl } = fromSnapshot();
  const el = e.target as Element;
  // never capture the typed value of a secret field; the fingerprint of the field is fine
  pending = { fromUrl: location.href, snap, ref: refByEl.get(el) ?? null };
}, true);

// after navigation settles, emit the RawStep for the click that caused it
window.addEventListener('load', () => {
  if (!recording || !pending) return;
  const step = {
    fromUrl: pending.fromUrl, fromSnapshot: pending.snap,
    toUrl: location.href, toSnapshot: fromSnapshot().snap,
    navigated: pending.fromUrl !== location.href, ref: pending.ref,
  };
  chrome.runtime.sendMessage({ type: 'step', step });
  pending = null;
});
```

Note: `isSecret` is referenced for the value-capture guard; since we never read `.value` anywhere, no secret is captured — the guard is the documented invariant. Keep the function as the explicit marker of the rule.

- [ ] **Step 4: background — buffer + POST on stop**

```typescript
// webnav-recorder/background.ts
type RawStep = { fromUrl: string; fromSnapshot: string; toUrl: string; toSnapshot: string; navigated: boolean; ref: string | null };
let buffer: RawStep[] = [];

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === 'step') { buffer.push(msg.step); reply?.({ ok: true }); return; }
  if (msg.type === 'stop') {
    const { sessionId, ingestUrl } = msg;
    fetch(ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, steps: buffer }) })
      .then((r) => r.json()).then((j) => { buffer = []; reply?.(j); })
      .catch((e) => reply?.({ ok: false, error: String(e) }));
    return true; // async reply
  }
  if (msg.type === 'reset') { buffer = []; reply?.({ ok: true }); }
});
```

- [ ] **Step 5: popup — toggle + send**

```html
<!-- webnav-recorder/popup.html -->
<body style="font:13px sans-serif;width:240px;padding:10px">
  <label>Session <input id="sid" value="human-1" style="width:100%"></label>
  <label>Ingest URL <input id="url" value="http://127.0.0.1:7778/ingest" style="width:100%"></label>
  <button id="rec">Record</button> <button id="stop">Stop & send</button>
  <pre id="out"></pre>
  <script src="popup.js" type="module"></script>
</body>
```

```typescript
// webnav-recorder/popup.ts
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
$('rec').onclick = () => chrome.storage.local.set({ recording: true }, () => { $('out').textContent = 'recording…'; });
$('stop').onclick = () => {
  chrome.storage.local.set({ recording: false });
  chrome.runtime.sendMessage(
    { type: 'stop', sessionId: $('sid').value, ingestUrl: $('url').value },
    (r) => { $('out').textContent = JSON.stringify(r); });
};
```

- [ ] **Step 6: tsconfig + README**

```json
// webnav-recorder/tsconfig.json
{ "compilerOptions": { "target": "ES2020", "module": "ES2020", "moduleResolution": "bundler",
  "outDir": ".", "lib": ["ES2020", "DOM"], "types": ["chrome"], "strict": true },
  "include": ["*.ts"] }
```

```markdown
<!-- webnav-recorder/README.md -->
# webnav recorder (Chrome MV3)
1. `cd webnav-recorder && npm i -D typescript @types/chrome && npm run build`
2. `webnav dev ingest --port 7778` (in the webnav repo)
3. chrome://extensions → Developer mode → Load unpacked → select this folder
4. Open a site, click the extension → set session name → **Record** → do the flow → **Stop & send**
5. Back in webnav: `webnav dev graph-analyse <session> --draft` → `graph-edit` → `walk`
Secret rule: password / credit-card fields are never read for their value.
```

- [ ] **Step 7: Build the extension**

Run: `cd webnav-recorder && npm i -D typescript @types/chrome && npm run build`
Expected: `content.js`, `background.js`, `popup.js`, `serialize.js` emitted; tsc exit 0.

- [ ] **Step 8: Manual smoke (the real end-to-end proof)**

1. `webnav dev ingest --port 7778`
2. Load unpacked; on saucedemo, Record → log in → add item → go to cart → Stop & send.
3. Expect popup shows `{"ok":true,"appended":N}`.
4. `webnav dev graph-analyse human-1 --draft` → non-empty draft with states/edges.
5. `webnav dev graph-edit ...` then `webnav walk --start ... --goal ...` → reaches goal.

- [ ] **Step 9: Commit**

```bash
git add webnav-recorder/
echo "webnav-recorder/*.js" >> .gitignore   # don't commit tsc output
echo "webnav-recorder/node_modules/" >> .gitignore
git add .gitignore
git commit -m "feat(recorder): Chrome MV3 extension — capture human sessions → dev ingest"
```

---

## Task 5: Docs sync

**Files:**
- Modify: `docs/STATUS.md` (add the recorder to the live handoff; also note it was stale — see review finding)
- Modify: `README.md` (add the record-with-the-extension path alongside import-a-pack + agent record)

- [ ] **Step 1: Update STATUS.md** — add a dated entry: human-session recorder DONE (extension → `dev ingest` → existing pipeline; two-producers-one-sink; agent path unchanged). Also fold in the post-2026-06-13 commits STATUS.md never captured (import-map/mappacks, benchmark v2, adoption) so the handoff is current.

- [ ] **Step 2: Update README.md** — under the map-building section, add: "Record a site by browsing it yourself (Chrome extension) → `webnav dev ingest`" as a third build path beside import-a-pack and agent-record.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md README.md
git commit -m "docs: human-session recorder + sync STATUS/README to current reality"
```

---

## Self-Review

**Spec coverage:**
- Extension (MV3, isolated pkg) → Task 4. ✓
- a11y serializer parity → Task 1. ✓
- `dev ingest` verb + localhost receiver → Task 3. ✓
- Server-side `diff` + `elementFp` reconstruction → Task 2 (a simplification vs the spec: fingerprint is ALSO reconstructed server-side via `recoverFingerprint`, so the extension emits only a synthetic ref, not the fp. Strictly lazier; noted here). ✓
- Secret-field rule → Task 4 (`isSecret` guard + never reading `.value`). ✓
- Round-trip: human session ≡ agent session → Task 2 test (`draftFromEffects`). ✓
- Testing: parity test (Task 1), round-trip (Task 2), receiver (Task 3), manual smoke (Task 4). ✓
- Scope cuts (no hosted backend / no Mode-S enrollment / no usage-weighting / Chrome-only / no screenshots) → respected; nothing in the plan builds them. ✓

**Placeholder scan:** none — every code step has full code. The one soft spot: Task 2/Task 4 assume `draftFromEffects` returns `{states}` and the extension's DOM-walk approximates roles; both are flagged to verify against the real return type / real pages during execution.

**Type consistency:** `RawStep`/`IngestBody` identical across Tasks 2–4; `serializeSnapshot`(repo) ↔ `serialize`(extension) are twins with a sync comment; `appendActionEffect` (not `append`) used for effects; `recoverFingerprint(nodes, ref)` and `diffSnapshots(SnapNode[], SnapNode[])` signatures match the code read on 2026-07-07.

**Known execution risk (call out to the implementer):** the extension's `domToSNode`/`fromSnapshot` roles/names are a DOM approximation, not a true a11y computation. If `walk` later fails to resolve human-recorded elements, that approximation is the first suspect — upgrade it toward `chrome.automation` (real a11y tree) before blaming the pipeline. The parity test guarantees the *format*, not the *role/name fidelity* of live pages.
