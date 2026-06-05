# Agent-Driven Site Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give webnav a record → analyse → edit-graph substrate so an agent can explore an unknown website (driving via webnav's `use` browser primitives), then have webnav mechanically derive a per-site navigation skeleton (zero-LLM, data not prose) that the agent validates, names, and persists.

**Architecture:** A new SQLite-backed record buffer captures each page (url + fingerprint + declared links) that flows through webnav's browse primitives while a session is "recording". `graph-analyse` reads that buffer and deterministically clusters pages into state-TYPES by fingerprint, derives declared edges, groups per-domain, and returns machine-labelled structure. `graph-edit` upserts the agent's validated graph. The CLI splits into two categories: `use` (drive browser + query map) and `dev` (author the map). Existing consumer verbs move under `use`.

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 22 here — `npm rebuild better-sqlite3` if native errors), `better-sqlite3`, vitest. Reuses `deriveEdges` (`src/explorer/explorer.ts`), `matchState`/fingerprint tokens (`src/explorer/fingerprint.ts`), `parseSnapshot`/`SnapNode` (`src/playwright/snapshot.ts`), `PlaywrightAdapter` (`src/playwright/adapter.ts`), `MapStore` (`src/mapstore/store.ts`).

**Spec:** `docs/superpowers/specs/2026-06-04-agent-driven-site-mapping-design.md`

---

## File structure

**New files:**
- `src/mapstore/record.ts` — the record buffer: types + `RecordStore` (start/stop/append/read), backed by two new SQLite tables. One responsibility: persist raw observations per session.
- `src/explorer/analyse.ts` — `analyseObservations(observations) → { sites, crossSiteEdges }`. Pure function, no I/O. The deterministic clustering + edge derivation. One responsibility: observations → proposed structure.
- `src/explorer/fingerprint-page.ts` — `fingerprintPage(SnapNode[]) → string[]` and `declaredLinks(SnapNode[]) → {to,via}[]`. The mechanical "read a page's structural signature + its declared links". One responsibility: turn one snapshot into structural features.
- `src/graph/edit.ts` — `editGraph(store, node, graphJson) → result`. Upsert validated states+edges into a node's interior; create the node if new; reject dangling edge endpoints. One responsibility: the agent's graph write API.
- `src/graph/show.ts` — `showInterior(store, node) → { node, states, edges }`. Read a node's persisted skeleton. (Thin; may reuse `statesForNode` + `edgesFrom`.)

**Modified files:**
- `src/mapstore/schema.sql` — add `record_sessions` + `record_observations` tables.
- `src/playwright/adapter.ts` — add `waitFor`; (existing methods already cover navigate/click/type/snapshot).
- `src/router/browse.ts` — add a `recordHook` so a browse through webnav appends an observation when a session is active.
- `src/cli-spec.ts` — add the new `dev` command specs; recategorize consumer verbs under `use`.
- `src/cli.ts` — parse + dispatch the new verbs; route consumer verbs under `use`.
- `src/cli-help.ts` — render the `use`/`dev` category split.
- Tests under `tests/` mirroring each.

---

## Task 1: Record buffer schema + RecordStore — TDD

**Files:**
- Modify: `src/mapstore/schema.sql`
- Create: `src/mapstore/record.ts`
- Test: `tests/mapstore/record.test.ts`

The buffer persists raw observations keyed by a session id. An observation is one page-load: `{ url, fingerprint, declaredLinks }`. `RecordStore` wraps a `better-sqlite3` Database (same handle style as `MapStore`).

- [ ] **Step 1: Add the tables to the schema**

In `src/mapstore/schema.sql`, append:

```sql
CREATE TABLE IF NOT EXISTS record_sessions (
  session_id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL, stopped_at INTEGER
);
CREATE TABLE IF NOT EXISTS record_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  url TEXT NOT NULL, fingerprint TEXT NOT NULL, declared_links TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `tests/mapstore/record.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function freshStore(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}

describe('RecordStore', () => {
  it('starts a session, appends observations, reads them back in order', () => {
    const store = freshStore();
    const id = store.start('sess-1', 1000);
    expect(id).toBe('sess-1');
    store.append('sess-1', { url: 'https://github.com/a', fingerprint: ['searchbox'], declaredLinks: [{ to: 'https://github.com/b', via: 'follow link "B"' }] }, 1001);
    store.append('sess-1', { url: 'https://github.com/b', fingerprint: ['heading'], declaredLinks: [] }, 1002);
    const obs = store.observations('sess-1');
    expect(obs).toHaveLength(2);
    expect(obs[0].url).toBe('https://github.com/a');
    expect(obs[0].seq).toBe(0);
    expect(obs[1].seq).toBe(1);
    expect(obs[0].declaredLinks[0].via).toBe('follow link "B"');
  });

  it('stop() marks the session inactive and isActive reflects it', () => {
    const store = freshStore();
    store.start('s', 1);
    expect(store.isActive('s')).toBe(true);
    store.stop('s', 2);
    expect(store.isActive('s')).toBe(false);
  });

  it('append to an inactive session is a no-op (recording is off)', () => {
    const store = freshStore();
    store.start('s', 1);
    store.stop('s', 2);
    store.append('s', { url: 'u', fingerprint: [], declaredLinks: [] }, 3);
    expect(store.observations('s')).toHaveLength(0);
  });

  it('isActive is false for an unknown session', () => {
    expect(freshStore().isActive('nope')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/record.test.ts`
Expected: FAIL — `Cannot find module '../../src/mapstore/record.js'`.

- [ ] **Step 4: Implement `RecordStore`**

Create `src/mapstore/record.ts`:

```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export interface DeclaredLink { to: string; via: string; }
export interface Observation { url: string; fingerprint: string[]; declaredLinks: DeclaredLink[]; }
export interface StoredObservation extends Observation { seq: number; capturedAt: number; }

/** Persists raw page observations per record-session. Sibling of MapStore;
 *  same Database handle, separate tables. No clustering here — that's analyse. */
export class RecordStore {
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }
  static fromDatabase(db: Database.Database): RecordStore {
    const s = Object.create(RecordStore.prototype) as RecordStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    return s;
  }

  start(sessionId: string, nowMs = Date.now()): string {
    this.db.prepare(
      `INSERT INTO record_sessions (session_id,active,started_at) VALUES (?,1,?)
       ON CONFLICT(session_id) DO UPDATE SET active=1, started_at=?, stopped_at=NULL`)
      .run(sessionId, nowMs, nowMs);
    return sessionId;
  }
  stop(sessionId: string, nowMs = Date.now()): void {
    this.db.prepare('UPDATE record_sessions SET active=0, stopped_at=? WHERE session_id=?')
      .run(nowMs, sessionId);
  }
  isActive(sessionId: string): boolean {
    const r: any = this.db.prepare('SELECT active FROM record_sessions WHERE session_id=?').get(sessionId);
    return !!r && r.active === 1;
  }
  append(sessionId: string, obs: Observation, nowMs = Date.now()): void {
    if (!this.isActive(sessionId)) return; // recording off → no-op
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_observations WHERE session_id=?').get(sessionId);
    this.db.prepare(
      `INSERT INTO record_observations (session_id,seq,url,fingerprint,declared_links,captured_at)
       VALUES (?,?,?,?,?,?)`)
      .run(sessionId, seq.c, obs.url, JSON.stringify(obs.fingerprint),
        JSON.stringify(obs.declaredLinks), nowMs);
  }
  observations(sessionId: string): StoredObservation[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM record_observations WHERE session_id=? ORDER BY seq').all(sessionId);
    return rows.map((r) => ({ url: r.url, fingerprint: JSON.parse(r.fingerprint),
      declaredLinks: JSON.parse(r.declared_links), seq: r.seq, capturedAt: r.captured_at }));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/record.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/mapstore/schema.sql src/mapstore/record.ts tests/mapstore/record.test.ts
git commit -m "feat(mapstore): RecordStore — per-session page observation buffer"
```

---

## Task 2: Page fingerprint + declared-links extraction — TDD

**Files:**
- Create: `src/explorer/fingerprint-page.ts`
- Test: `tests/explorer/fingerprint-page.test.ts`

`fingerprintPage` turns a parsed snapshot into a stable structural signature — the SORTED, DEDUPED set of `role` tokens present (matching the `role` / `role:name` token format in `fingerprint.ts`). For v1 we use bare `role` tokens (cheap, stable). `declaredLinks` extracts the navigable links the page declares (role `link` with a url), mapped to `{ to, via }` shaped like `deriveEdges` output.

- [ ] **Step 1: Write the failing test**

Create `tests/explorer/fingerprint-page.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { fingerprintPage, declaredLinks } from '../../src/explorer/fingerprint-page.js';
import type { SnapNode } from '../../src/playwright/snapshot.js';

function n(role: string, name: string | null = null, url: string | null = null, ref: string | null = null): SnapNode {
  return { role, name, url, ref, raw: '' } as SnapNode;
}

describe('fingerprintPage', () => {
  it('returns the sorted, deduped set of role tokens', () => {
    const fp = fingerprintPage([n('heading'), n('link', 'A'), n('link', 'B'), n('searchbox')]);
    expect(fp).toEqual(['heading', 'link', 'searchbox']);
  });
  it('two pages with the same role set produce the same fingerprint', () => {
    const a = fingerprintPage([n('heading'), n('link', 'X')]);
    const b = fingerprintPage([n('link', 'Y'), n('heading')]);
    expect(a).toEqual(b);
  });
});

describe('declaredLinks', () => {
  it('extracts link nodes that carry a url, as {to, via}', () => {
    const links = declaredLinks([
      n('link', 'Issues', 'https://github.com/o/r/issues'),
      n('link', null, 'https://github.com/o/r/pulls'),
      n('button', 'Star'), // not a link → ignored
      n('link', 'NoUrl'),  // link without url → ignored
    ]);
    expect(links).toEqual([
      { to: 'https://github.com/o/r/issues', via: 'follow link "Issues"' },
      { to: 'https://github.com/o/r/pulls', via: 'follow link "https://github.com/o/r/pulls"' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explorer/fingerprint-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/explorer/fingerprint-page.ts`:

```typescript
import type { SnapNode } from '../playwright/snapshot.js';
import type { DeclaredLink } from '../mapstore/record.js';

/**
 * The structural signature of a page: the sorted, deduped set of element ROLES
 * present. Two pages of the same TYPE (a repo-detail vs another repo-detail)
 * share a fingerprint; instances collapse. Purely mechanical — no judgment.
 */
export function fingerprintPage(nodes: SnapNode[]): string[] {
  return [...new Set(nodes.map((n) => n.role))].sort();
}

/** The navigable links a page declares: role 'link' WITH a url. `via` mirrors
 *  deriveEdges' phrasing so analysed edges read consistently with the rest. */
export function declaredLinks(nodes: SnapNode[]): DeclaredLink[] {
  const out: DeclaredLink[] = [];
  for (const n of nodes) {
    if (n.role !== 'link' || !n.url) continue;
    out.push({ to: n.url, via: `follow link "${n.name ?? n.url}"` });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explorer/fingerprint-page.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/fingerprint-page.ts tests/explorer/fingerprint-page.test.ts
git commit -m "feat(explorer): fingerprintPage + declaredLinks (mechanical page features)"
```

---

## Task 3: `analyseObservations` — observations → per-site structure — TDD

**Files:**
- Create: `src/explorer/analyse.ts`
- Test: `tests/explorer/analyse.test.ts`

The core deterministic function. Input: `StoredObservation[]` (from `RecordStore.observations`). Output: `{ sites: [{ node, states, edges }], crossSiteEdges }`. Algorithm:
1. Derive each observation's site-node = the host of its url (`new URL(url).host`).
2. Within a site, cluster observations by IDENTICAL fingerprint → one state-type per distinct fingerprint, machine-labelled `<node>:state-type-N` (N in first-seen order). Record `fingerprint`, `urlPatterns` (distinct), `pageCount`, `sampleUrls` (up to 3).
3. Edges: for each observation, for each declared link, if the link's host == the observation's host AND the link's url maps to a known state-type in that site (its host+fingerprint was observed), emit an intra-site edge `from`=this obs's state-type, `to`=the linked page's state-type, `via`=the link's via. Dedup by (from,to,via). A link whose target was never observed is dropped (we only graph types we actually saw).
4. Cross-site edges: a declared link whose host != the observation's host → a `crossSiteEdge` `{ from: thisHost, to: linkHost, via }`, deduped by (from,to).
**No prose. No "similar"/"consider"/semantic names.**

- [ ] **Step 1: Write the failing test**

Create `tests/explorer/analyse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { analyseObservations } from '../../src/explorer/analyse.js';
import type { StoredObservation } from '../../src/mapstore/record.js';

function obs(url: string, fingerprint: string[], links: { to: string; via: string }[] = [], seq = 0): StoredObservation {
  return { url, fingerprint, declaredLinks: links, seq, capturedAt: 0 };
}

describe('analyseObservations', () => {
  it('clusters same-fingerprint pages of one site into one state-type', () => {
    const r = analyseObservations([
      obs('https://github.com/a/x', ['heading', 'link'], [], 0),
      obs('https://github.com/b/y', ['heading', 'link'], [], 1),
      obs('https://github.com/search', ['searchbox'], [], 2),
    ]);
    expect(r.sites).toHaveLength(1);
    const gh = r.sites[0];
    expect(gh.node).toBe('github.com');
    expect(gh.states).toHaveLength(2); // detail-type (x2 pages) + search-type
    const detail = gh.states.find((s) => s.fingerprint.join(',') === 'heading,link')!;
    expect(detail.pageCount).toBe(2);
    expect(detail.sampleUrls).toContain('https://github.com/a/x');
    expect(detail.label).toMatch(/state-type-\d+/);
    // mechanical only — no prose field
    expect(Object.keys(detail)).not.toContain('description');
  });

  it('derives an intra-site edge when one observed page links to another observed type', () => {
    const r = analyseObservations([
      obs('https://github.com/search', ['searchbox', 'link'],
        [{ to: 'https://github.com/o/r', via: 'follow link "o/r"' }], 0),
      obs('https://github.com/o/r', ['heading'], [], 1),
    ]);
    const gh = r.sites[0];
    expect(gh.edges).toHaveLength(1);
    const from = gh.states.find((s) => s.fingerprint.includes('searchbox'))!.label;
    const to = gh.states.find((s) => s.fingerprint.join(',') === 'heading')!.label;
    expect(gh.edges[0]).toMatchObject({ from, to, via: 'follow link "o/r"' });
  });

  it('drops links whose target page was never observed', () => {
    const r = analyseObservations([
      obs('https://github.com/search', ['searchbox'],
        [{ to: 'https://github.com/never/seen', via: 'follow link "x"' }], 0),
    ]);
    expect(r.sites[0].edges).toHaveLength(0);
  });

  it('groups multiple sites separately and records cross-site edges', () => {
    const r = analyseObservations([
      obs('https://github.com/o/r', ['heading'],
        [{ to: 'https://pypi.org/project/r', via: 'follow link "PyPI"' }], 0),
      obs('https://pypi.org/project/r', ['heading', 'table'], [], 1),
    ]);
    expect(r.sites.map((s) => s.node).sort()).toEqual(['github.com', 'pypi.org']);
    expect(r.crossSiteEdges).toEqual([
      { from: 'github.com', to: 'pypi.org', via: 'follow link "PyPI"' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explorer/analyse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/explorer/analyse.ts`:

```typescript
import type { StoredObservation } from '../mapstore/record.js';

export interface AnalysedState {
  label: string;          // machine label, e.g. 'github.com:state-type-1'
  fingerprint: string[];
  urlPatterns: string[];  // distinct urls' paths seen for this type (raw urls for v1)
  pageCount: number;
  sampleUrls: string[];   // up to 3
}
export interface AnalysedEdge { from: string; to: string; via: string; }
export interface AnalysedSite { node: string; states: AnalysedState[]; edges: AnalysedEdge[]; }
export interface CrossSiteEdge { from: string; to: string; via: string; }
export interface AnalysisResult { sites: AnalysedSite[]; crossSiteEdges: CrossSiteEdge[]; }

function host(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}
const fpKey = (fp: string[]) => fp.join('|');

export function analyseObservations(observations: StoredObservation[]): AnalysisResult {
  // node -> fingerprint-key -> state accumulator
  const sites = new Map<string, Map<string, AnalysedState>>();
  // (node, url) -> state label, so edges can resolve a link target to a type.
  const urlToLabel = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const o of observations) {
    const node = host(o.url);
    if (!node) continue;
    if (!sites.has(node)) { sites.set(node, new Map()); counters.set(node, 0); }
    const states = sites.get(node)!;
    const key = fpKey(o.fingerprint);
    let st = states.get(key);
    if (!st) {
      const n = counters.get(node)! + 1; counters.set(node, n);
      st = { label: `${node}:state-type-${n}`, fingerprint: o.fingerprint,
        urlPatterns: [], pageCount: 0, sampleUrls: [] };
      states.set(key, st);
    }
    st.pageCount++;
    if (!st.urlPatterns.includes(o.url)) st.urlPatterns.push(o.url);
    if (st.sampleUrls.length < 3) st.sampleUrls.push(o.url);
    urlToLabel.set(`${node}\n${o.url}`, st.label);
  }

  // Edges (second pass: all labels are now known).
  const edgeSets = new Map<string, Set<string>>();         // node -> "from|to|via"
  const crossSet = new Set<string>();                       // "from|to|via"
  const crossSiteEdges: CrossSiteEdge[] = [];
  for (const o of observations) {
    const node = host(o.url);
    if (!node) continue;
    const fromLabel = urlToLabel.get(`${node}\n${o.url}`);
    if (!fromLabel) continue;
    for (const link of o.declaredLinks) {
      const linkHost = host(link.to);
      if (!linkHost) continue;
      if (linkHost === node) {
        const toLabel = urlToLabel.get(`${node}\n${link.to}`);
        if (!toLabel) continue;                 // target type never observed → drop
        if (!edgeSets.has(node)) edgeSets.set(node, new Set());
        edgeSets.get(node)!.add(`${fromLabel}|${toLabel}|${link.via}`);
      } else {
        const k = `${node}|${linkHost}|${link.via}`;
        if (!crossSet.has(k)) { crossSet.add(k); crossSiteEdges.push({ from: node, to: linkHost, via: link.via }); }
      }
    }
  }

  const result: AnalysedSite[] = [];
  for (const [node, states] of sites) {
    const edges: AnalysedEdge[] = [...(edgeSets.get(node) ?? [])].map((s) => {
      const [from, to, via] = s.split('|'); return { from, to, via };
    });
    result.push({ node, states: [...states.values()], edges });
  }
  result.sort((a, b) => a.node.localeCompare(b.node));
  return { sites: result, crossSiteEdges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explorer/analyse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/analyse.ts tests/explorer/analyse.test.ts
git commit -m "feat(explorer): analyseObservations — per-site structure (zero-LLM, no prose)"
```

---

## Task 4: `editGraph` — the agent's validated-graph write API — TDD

**Files:**
- Create: `src/graph/edit.ts`
- Test: `tests/graph/edit.test.ts`

Upserts the agent's validated graph into a node's interior. Input: `store`, `node` (id/host), and a graph `{ states: [{label, urlPattern?, fingerprint?}], edges: [{from, to, via, needsInput?, why?}] }`. Behavior:
- Create the site-node if it doesn't exist (`upsertNode` with empty capabilities/topics — agent can enrich later via `node-add`).
- Each state → `upsertState` with id `<node>:<label>`, `nodeId`=node, `semanticName`=label, `urlPattern`=given or `''`, `role`='detail' (default; structure-only), `fingerprint`=given or `[]`.
- Each edge → `upsertEdge` with `fromState`=`<node>:<from>`, `toState`=`<node>:<to>`, `semanticStep`=via, `kind`= `needsInput ? 'unclassified' : 'navigate'`. `needsInput`/`why` is encoded by marking the edge `unclassified` and storing `why` in `semanticStep` suffix `" [needs-input: <why>]"` (durable, inspectable; no schema change).
- Reject (throw) an edge whose `from`/`to` label is neither in the payload's states NOR already a stored state for this node — naming the offending label.
- All within one `store.transaction` (atomic).
- Return `{ node, statesWritten, edgesWritten }`.

- [ ] **Step 1: Write the failing test**

Create `tests/graph/edit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';

function freshStore(): MapStore {
  return MapStore.fromDatabase(new Database(':memory:'));
}

describe('editGraph', () => {
  it('creates the node if new and upserts states + edges', () => {
    const store = freshStore();
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'home', fingerprint: ['link'] }, { label: 'detail', urlPattern: 'example.com/*' }],
      edges: [{ from: 'home', to: 'detail', via: 'follow a result link' }],
    });
    expect(r).toMatchObject({ node: 'example.com', statesWritten: 2, edgesWritten: 1 });
    expect(store.getNode('example.com')).not.toBeNull();
    expect(store.getState('example.com:detail')!.nodeId).toBe('example.com');
    const edges = store.edgesFrom('example.com:home');
    expect(edges[0]).toMatchObject({ toState: 'example.com:detail', kind: 'navigate' });
  });

  it('marks a needsInput edge unclassified and records why in the step', () => {
    const store = freshStore();
    editGraph(store, 'example.com', {
      states: [{ label: 'detail' }, { label: 'login' }],
      edges: [{ from: 'detail', to: 'login', via: 'click Sign in', needsInput: true, why: 'requires credentials' }],
    });
    const e = store.edgesFrom('example.com:detail')[0];
    expect(e.kind).toBe('unclassified');
    expect(e.semanticStep).toContain('needs-input: requires credentials');
  });

  it('links to an already-stored state without re-declaring it', () => {
    const store = freshStore();
    editGraph(store, 'example.com', { states: [{ label: 'a' }], edges: [] });
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'b' }], edges: [{ from: 'b', to: 'a', via: 'go' }],
    });
    expect(r.edgesWritten).toBe(1);
    expect(store.edgesFrom('example.com:b')[0].toState).toBe('example.com:a');
  });

  it('throws on an edge endpoint that is neither in the payload nor stored', () => {
    const store = freshStore();
    expect(() => editGraph(store, 'example.com', {
      states: [{ label: 'a' }], edges: [{ from: 'a', to: 'ghost', via: 'go' }],
    })).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/graph/edit.ts`:

```typescript
import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge } from '../mapstore/types.js';

export interface EditState { label: string; urlPattern?: string; fingerprint?: string[]; }
export interface EditEdge { from: string; to: string; via: string; needsInput?: boolean; why?: string; }
export interface EditGraph { states: EditState[]; edges: EditEdge[]; }
export interface EditResult { node: string; statesWritten: number; edgesWritten: number; }

export function editGraph(store: MapStore, node: string, graph: EditGraph): EditResult {
  const stateId = (label: string) => `${node}:${label}`;
  // Labels that will exist after this edit: payload states + already-stored states.
  const payloadLabels = new Set(graph.states.map((s) => s.label));
  const knownLabel = (label: string) =>
    payloadLabels.has(label) || store.getState(stateId(label)) !== null;

  // Validate edge endpoints BEFORE any write (fail fast, atomic).
  for (const e of graph.edges) {
    for (const ep of [e.from, e.to]) {
      if (!knownLabel(ep)) {
        throw new Error(`editGraph: edge endpoint "${ep}" is not a declared or stored state for node "${node}"`);
      }
    }
  }

  let statesWritten = 0, edgesWritten = 0;
  store.transaction(() => {
    if (!store.getNode(node)) {
      store.upsertNode({ id: node, homeUrl: `https://${node}`, capabilities: [], topics: [] });
    }
    for (const s of graph.states) {
      store.upsertState(makeState({
        id: stateId(s.label), nodeId: node, semanticName: s.label,
        urlPattern: s.urlPattern ?? '', role: 'detail',
        fingerprint: s.fingerprint ?? [],
      }));
      statesWritten++;
    }
    for (const e of graph.edges) {
      const step = e.needsInput ? `${e.via} [needs-input: ${e.why ?? 'unspecified'}]` : e.via;
      store.upsertEdge(makeEdge({
        fromState: stateId(e.from), toState: stateId(e.to),
        semanticStep: step, kind: e.needsInput ? 'unclassified' : 'navigate',
      }));
      edgesWritten++;
    }
  });
  return { node, statesWritten, edgesWritten };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/graph/edit.ts tests/graph/edit.test.ts
git commit -m "feat(graph): editGraph — upsert the agent's validated interior (creates node if new)"
```

---

## Task 5: `showInterior` — read a node's persisted skeleton — TDD

**Files:**
- Create: `src/graph/show.ts`
- Test: `tests/graph/show.test.ts`

Returns `{ node, states, edges }` for a node so the agent can validate against what's stored. States via `statesForNode`; edges = all edges whose `fromState` starts with `<node>:`.

- [ ] **Step 1: Write the failing test**

Create `tests/graph/show.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';
import { showInterior } from '../../src/graph/show.js';

describe('showInterior', () => {
  it('returns the states + edges stored for a node', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'example.com', {
      states: [{ label: 'home' }, { label: 'detail' }],
      edges: [{ from: 'home', to: 'detail', via: 'go' }],
    });
    const r = showInterior(store, 'example.com');
    expect(r.node).toBe('example.com');
    expect(r.states.map((s) => s.semanticName).sort()).toEqual(['detail', 'home']);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]).toMatchObject({ fromState: 'example.com:home', toState: 'example.com:detail' });
  });

  it('returns empty arrays for an unknown node', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    const r = showInterior(store, 'nope.com');
    expect(r.states).toEqual([]);
    expect(r.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/show.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/graph/show.ts`:

```typescript
import type { MapStore } from '../mapstore/store.js';
import type { State, Edge } from '../mapstore/types.js';

export interface Interior { node: string; states: State[]; edges: Edge[]; }

export function showInterior(store: MapStore, node: string): Interior {
  const states = store.statesForNode(node);
  const prefix = `${node}:`;
  const edges = store.allEdges().filter((e) => e.fromState.startsWith(prefix));
  return { node, states, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/show.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/graph/show.ts tests/graph/show.test.ts
git commit -m "feat(graph): showInterior — read a node's persisted skeleton"
```

---

## Task 6: Adapter `waitFor` + a recordable browse helper — TDD

**Files:**
- Modify: `src/playwright/adapter.ts`
- Modify: `src/router/browse.ts`
- Test: `tests/router/browse-record.test.ts`

Add `waitFor` to the adapter (parity with playwright-cli). Add `runSnapshotRecorded(url, sessionId, recordStore, adapter?)` to `browse.ts`: opens the url, snapshots, and if `recordStore.isActive(sessionId)` appends an observation built via `fingerprintPage`/`declaredLinks`. Returns `{ status, url, recorded }`. This is the seam that makes a webnav browse RECORDABLE.

- [ ] **Step 1: Add `waitFor` to the adapter**

In `src/playwright/adapter.ts`, after `reload()`:

```typescript
  waitFor(condition: string) { return this.exec('wait-for', condition); }
```

- [ ] **Step 2: Write the failing test**

Create `tests/router/browse-record.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runSnapshotRecorded } from '../../src/router/browse.js';

const FAKE_SNAPSHOT = `- heading "requests" [ref=e1]
- link "Issues" [ref=e2]
  /url: https://github.com/psf/requests/issues`;

function fakeAdapter() {
  return {
    open: async () => '',
    snapshot: async () => FAKE_SNAPSHOT,
    close: async () => '',
  };
}

describe('runSnapshotRecorded', () => {
  it('appends one observation (fingerprint + declared links) when recording is active', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s', 1);
    const r = await runSnapshotRecorded('https://github.com/psf/requests', 's', rec, fakeAdapter() as any);
    expect(r.status).toBe('done');
    expect(r.recorded).toBe(true);
    const obs = rec.observations('s');
    expect(obs).toHaveLength(1);
    expect(obs[0].fingerprint).toEqual(['heading', 'link']);
    expect(obs[0].declaredLinks[0].to).toBe('https://github.com/psf/requests/issues');
  });

  it('does not record when no session is active', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    const r = await runSnapshotRecorded('https://x.com', 's', rec, fakeAdapter() as any);
    expect(r.recorded).toBe(false);
    expect(rec.observations('s')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/router/browse-record.test.ts`
Expected: FAIL — `runSnapshotRecorded` not exported.

- [ ] **Step 4: Implement in `browse.ts`**

Add to `src/router/browse.ts` (the existing file already imports `PlaywrightAdapter` and defines `BrowseAdapter`):

```typescript
import { parseSnapshot } from '../playwright/snapshot.js';
import { fingerprintPage, declaredLinks } from '../explorer/fingerprint-page.js';
import type { RecordStore } from '../mapstore/record.js';

// Extend BrowseAdapter (in this file) with snapshot for recorded browsing.
// (Add `snapshot?(): Promise<string>;` to the BrowseAdapter interface.)

export interface SnapshotRecordedResult { status: 'done' | 'failed'; url: string; recorded: boolean; reason?: string; }

/** Open `url`, snapshot it, and (if `sessionId` is recording) append an
 *  observation. The seam that makes a webnav browse contribute to the map. */
export async function runSnapshotRecorded(
  url: string, sessionId: string, recordStore: RecordStore,
  adapter: BrowseAdapter = newAdapter(),
): Promise<SnapshotRecordedResult> {
  try {
    await adapter.open(url);
    const yml = await adapter.snapshot!();
    const nodes = parseSnapshot(yml);
    let recorded = false;
    if (recordStore.isActive(sessionId)) {
      recordStore.append(sessionId, {
        url, fingerprint: fingerprintPage(nodes), declaredLinks: declaredLinks(nodes),
      });
      recorded = true;
    }
    return { status: 'done', url, recorded };
  } catch (e) {
    return { status: 'failed', url, recorded: false, reason: String(e) };
  } finally {
    await adapter.close().catch(() => {});
  }
}
```

Also add `snapshot?(): Promise<string>;` to the `BrowseAdapter` interface near the top of `browse.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/router/browse-record.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/playwright/adapter.ts src/router/browse.ts tests/router/browse-record.test.ts
git commit -m "feat(router): runSnapshotRecorded + adapter waitFor — recordable browse seam"
```

---

## Task 7: Wire the `dev` mapping verbs into the CLI — TDD (parsing)

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli/parse-mapping.test.ts`

Add parsing for the new `dev` verbs. They are reached via `webnav dev <verb> …` (the existing `dev` dispatcher in `parseArgs` already re-parses `[sub, ...rest]`, so adding top-level cases makes them work under `dev`). New `ParsedArgs` variants:
- `record-start` → `{ cmd: 'record-start'; session: string }` (session defaults to `map-<timestamp>`; but timestamp is non-deterministic — accept `--session <id>`, else a caller-supplied positional; if absent, the dispatcher in `main` generates one).
- `record-stop` → `{ cmd: 'record-stop'; session: string }`
- `graph-analyse` → `{ cmd: 'graph-analyse'; session: string }`
- `graph-edit` → `{ cmd: 'graph-edit'; node: string; graph: string }` (`--node`, `--graph <json>`)
- `graph-show` → `{ cmd: 'graph-show'; node: string }` (`--node`)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/parse-mapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — mapping verbs (under dev)', () => {
  it('parses record-start with --session', () => {
    expect(parseArgs(['dev', 'record-start', '--session', 's1'])).toEqual({ cmd: 'record-start', session: 's1' });
  });
  it('parses record-stop', () => {
    expect(parseArgs(['dev', 'record-stop', '--session', 's1'])).toEqual({ cmd: 'record-stop', session: 's1' });
  });
  it('parses graph-analyse', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1'])).toEqual({ cmd: 'graph-analyse', session: 's1' });
  });
  it('parses graph-edit with node + graph json', () => {
    expect(parseArgs(['dev', 'graph-edit', '--node', 'example.com', '--graph', '{"states":[],"edges":[]}']))
      .toEqual({ cmd: 'graph-edit', node: 'example.com', graph: '{"states":[],"edges":[]}' });
  });
  it('parses graph-show', () => {
    expect(parseArgs(['dev', 'graph-show', '--node', 'example.com'])).toEqual({ cmd: 'graph-show', node: 'example.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/parse-mapping.test.ts`
Expected: FAIL — unknown command (the cases don't exist).

- [ ] **Step 3: Implement parsing**

In `src/cli.ts`, add to the `ParsedArgs` union:

```typescript
  | { cmd: 'record-start'; session: string }
  | { cmd: 'record-stop'; session: string }
  | { cmd: 'graph-analyse'; session: string }
  | { cmd: 'graph-edit'; node: string; graph: string }
  | { cmd: 'graph-show'; node: string }
```

In `parseArgs`, before the final `throw`, add:

```typescript
  if (cmd === 'record-start') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'record-stop') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'graph-analyse') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'graph-edit') return { cmd, node: flagValue(rest, '--node') ?? '', graph: flagValue(rest, '--graph') ?? '' };
  if (cmd === 'graph-show') return { cmd, node: flagValue(rest, '--node') ?? '' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/parse-mapping.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/parse-mapping.test.ts
git commit -m "feat(cli): parse dev mapping verbs (record-start/stop, graph-analyse/edit/show)"
```

---

## Task 8: Dispatch the mapping verbs in `main()` — manual verification

**Files:**
- Modify: `src/cli.ts`

Wire the parsed verbs to their implementations. No new unit test (parsing + each impl are already covered); verify by running the CLI against an in-repo temp DB. For `record-start` with no `--session`, generate `map-<Date.now()>`.

- [ ] **Step 1: Add dispatch blocks in `main()`**

In `src/cli.ts` `main()`, before the `recall` block, add:

```typescript
  if (args.cmd === 'record-start') {
    const { RecordStore } = await import('./mapstore/record.js');
    const rec = new RecordStore('webnav.db');
    const session = args.session || `map-${Date.now()}`;
    rec.start(session);
    console.log(JSON.stringify({ status: 'recording', session }, null, 2));
    return;
  }
  if (args.cmd === 'record-stop') {
    const { RecordStore } = await import('./mapstore/record.js');
    new RecordStore('webnav.db').stop(args.session);
    console.log(JSON.stringify({ status: 'stopped', session: args.session }, null, 2));
    return;
  }
  if (args.cmd === 'graph-analyse') {
    const { RecordStore } = await import('./mapstore/record.js');
    const { analyseObservations } = await import('./explorer/analyse.js');
    const obs = new RecordStore('webnav.db').observations(args.session);
    const result = analyseObservations(obs);
    console.log(JSON.stringify(result, null, 2));
    if (result.sites.length === 0) process.exitCode = 3;
    return;
  }
  if (args.cmd === 'graph-edit') {
    const { MapStore } = await import('./mapstore/store.js');
    const { editGraph } = await import('./graph/edit.js');
    const store = new MapStore('webnav.db');
    const graph = JSON.parse(args.graph);
    console.log(JSON.stringify(editGraph(store, args.node, graph), null, 2));
    return;
  }
  if (args.cmd === 'graph-show') {
    const { MapStore } = await import('./mapstore/store.js');
    const { showInterior } = await import('./graph/show.js');
    console.log(JSON.stringify(showInterior(new MapStore('webnav.db'), args.node), null, 2));
    return;
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: tsc succeeds (if `NODE_MODULE_VERSION` errors on a later step, run `npm rebuild better-sqlite3`).

- [ ] **Step 3: Manually verify the full flow against a temp DB**

Run (uses a throwaway DB so it can't touch the real map):

```bash
rm -f /tmp/map-test.db
WEBNAV_DB=/tmp/map-test.db npx tsx -e '
import { RecordStore } from "./src/mapstore/record.js";
import { analyseObservations } from "./src/explorer/analyse.js";
import { MapStore } from "./src/mapstore/store.js";
import { editGraph } from "./src/graph/edit.js";
import { showInterior } from "./src/graph/show.js";
const rec = new RecordStore("/tmp/map-test.db");
rec.start("s");
rec.append("s", { url: "https://github.com/search", fingerprint: ["searchbox","link"], declaredLinks: [{ to: "https://github.com/o/r", via: "follow link \"o/r\"" }] });
rec.append("s", { url: "https://github.com/o/r", fingerprint: ["heading"], declaredLinks: [] });
rec.stop("s");
const a = analyseObservations(rec.observations("s"));
console.log("ANALYSE:", JSON.stringify(a));
const store = new MapStore("/tmp/map-test.db");
editGraph(store, "github.com", { states: [{label:"search"},{label:"repo-detail"}], edges: [{from:"search",to:"repo-detail",via:"follow a result link"}] });
console.log("SHOW:", JSON.stringify(showInterior(store, "github.com")));
'
```

Expected: `ANALYSE:` shows one site `github.com` with 2 state-types and 1 edge; `SHOW:` shows 2 states (`github.com:search`, `github.com:repo-detail`) and 1 edge. (Note: the CLI verbs use the hardcoded `webnav.db`; the env-var path above is only for this isolated check. If you prefer, run the CLI verbs directly and clean up `webnav.db`'s record_* rows after.)

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): dispatch dev mapping verbs (record/analyse/edit/show)"
```

---

## Task 9: CLI help — `use`/`dev` categories + per-verb help — TDD

**Files:**
- Modify: `src/cli-spec.ts`
- Modify: `src/cli-help.ts`
- Test: `tests/cli/help-categories.test.ts`

Add `CommandSpec`s for the mapping verbs to the dev registry, and render the top-level help with a **use** heading (the existing Find/Read/Navigate consumer groups, now under "use") and a **dev** heading listing the authoring verbs. Read the current `cli-help.ts` to match its rendering style before editing.

- [ ] **Step 1: Read the current help renderer**

Read `src/cli-help.ts` (functions `topLevelHelp`, `devHelp`, `commandHelp`) and `src/cli-spec.ts` (the `DEV_COMMANDS` list, if present) to match naming/format. Note the exact heading strings used.

- [ ] **Step 2: Write the failing test**

Create `tests/cli/help-categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { topLevelHelp, devHelp, commandHelp } from '../../src/cli-help.js';

describe('help — use/dev categories', () => {
  it('top-level help shows a use section', () => {
    expect(topLevelHelp().toLowerCase()).toContain('use');
  });
  it('dev help lists the mapping verbs', () => {
    const h = devHelp();
    for (const v of ['record-start', 'record-stop', 'graph-analyse', 'graph-edit', 'graph-show']) {
      expect(h).toContain(v);
    }
  });
  it('per-verb help works for a mapping verb', () => {
    expect(commandHelp('graph-analyse').toLowerCase()).toContain('session');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/cli/help-categories.test.ts`
Expected: FAIL — the mapping verbs aren't in the dev registry / help yet.

- [ ] **Step 4: Add the specs + render them**

In `src/cli-spec.ts`, add the mapping verbs to the dev command registry (match the existing `DEV_COMMANDS` array shape; if dev verbs aren't yet in a registry, add the five with `args`/`flags`/`summary`/`example`). Example for one:

```typescript
  {
    name: 'graph-analyse',
    summary: 'Mechanically derive a per-site navigation structure from a record session (data only — the agent names + validates it).',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Record session id from `dev record-start`.' }],
    example: 'webnav dev graph-analyse --session map-123',
  },
```

(Repeat for `record-start`, `record-stop`, `graph-edit` [`--node`, `--graph`], `graph-show` [`--node`].) Then ensure `devHelp()` iterates these and `commandHelp()` can find them. If consumer verbs need a "use" heading, update `topLevelHelp()` to print "use" above the Find/Read/Navigate groups.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/help-categories.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/cli-spec.ts src/cli-help.ts tests/cli/help-categories.test.ts
git commit -m "feat(cli): use/dev help categories + per-verb help for mapping verbs"
```

---

## Task 10: Rename existing dev verbs entity-first — TDD

**Files:**
- Modify: `src/cli.ts`, `src/cli-spec.ts`
- Modify: any docs referencing `add-node`/`add-edge`
- Test: `tests/cli/parse.test.ts` (existing) or a small new assertion

Rename `add-node` → `node-add` and `add-edge` → `edge-add` (entity-first, per CLAUDE.md). Keep the implementations; only the verb strings change. Search for call sites first.

- [ ] **Step 1: Find all references**

Run: `grep -rn "add-node\|add-edge" src tests bench docs README.md`
Note each occurrence.

- [ ] **Step 2: Update the parser + spec**

In `src/cli.ts`, change `if (cmd === 'add-node')` → `if (cmd === 'node-add')` and `if (cmd === 'add-edge')` → `if (cmd === 'edge-add')` (and the `ParsedArgs` `cmd` literals + `KNOWN_VERBS`/`COMMANDS` entries in `cli-spec.ts`). Update the `example` strings to `webnav dev node-add …` / `webnav dev edge-add …`.

- [ ] **Step 3: Update tests + docs**

Update any test asserting the old names, and the references found in Step 1 (docs/README). 

- [ ] **Step 4: Run the affected tests**

Run: `npx vitest run tests/cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(cli): rename dev verbs entity-first (node-add, edge-add)"
```

---

## Task 11: Move consumer verbs under `use` — TDD (breaking change)

**Files:**
- Modify: `src/cli.ts` (add a `use` dispatcher mirroring the `dev` one)
- Modify: `bench/README.md`, e2e tests, docs that call verbs bare
- Test: `tests/cli/parse-use.test.ts`

Make `webnav use <verb> …` work for the consumer verbs by adding a `use` dispatcher in `parseArgs` that re-parses `[sub, ...rest]` (exactly like the existing `dev` branch). Keep bare verbs working too (so nothing breaks immediately), but update docs/help to present `use` as the canonical form. This satisfies the two-category model without a hard break of every call site at once.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/parse-use.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — use dispatcher', () => {
  it('use recall parses the same as bare recall', () => {
    expect(parseArgs(['use', 'recall', 'python retry'])).toEqual(parseArgs(['recall', 'python retry']));
  });
  it('use search parses the same as bare search', () => {
    expect(parseArgs(['use', 'search', 'rust orm'])).toEqual(parseArgs(['search', 'rust orm']));
  });
  it('use --help shows use help', () => {
    expect(parseArgs(['use', '--help'])).toEqual({ cmd: 'use-help' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/parse-use.test.ts`
Expected: FAIL — `use` is an unknown command.

- [ ] **Step 3: Implement the `use` dispatcher**

In `src/cli.ts` `parseArgs`, add (mirroring the `dev` branch) BEFORE the `dev` branch:

```typescript
  if (cmd === 'use') {
    const sub = rest[0];
    if (!sub || sub === '--help' || sub === '-h') return { cmd: 'use-help' };
    return parseArgs([sub, ...rest.slice(1)]);
  }
```

Add `| { cmd: 'use-help' }` to the `ParsedArgs` union. In `main()`, handle `use-help` by printing the consumer (use) section:

```typescript
  if (args.cmd === 'use-help') {
    console.log(topLevelHelp()); // top-level help already lists the consumer verbs
    return;
  }
```

(`topLevelHelp` is already imported at the top of `cli.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/parse-use.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update docs to the canonical `use` form**

Update `bench/README.md`, `README.md`, and any e2e/agent prompts to show `webnav use recall …`, `webnav use search …`, etc. (Bare forms still work, so this is documentation alignment, not a code break. Note in the doc that both work but `use`/`dev` is canonical.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): use dispatcher for consumer verbs (use/dev two-category model)"
```

---

## Task 12: Gated live e2e — a Haiku agent maps a slice of GitHub

**Files:**
- Create: `tests/e2e/site-mapping.live.test.ts`

A `WEBNAV_LIVE=1`-gated test: drive a real record → snapshot a couple of GitHub pages via `runSnapshotRecorded` against the live `PlaywrightAdapter` → `analyseObservations` → assert a sane multi-state structure. (The agent-in-the-loop part is exercised by the orchestrator separately per the subagent-model rule; this test proves the mechanical pipeline works live.)

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/site-mapping.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runSnapshotRecorded } from '../../src/router/browse.js';
import { analyseObservations } from '../../src/explorer/analyse.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: site mapping pipeline', () => {
  it('records two GitHub pages and analyses a multi-state structure', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('live-map');
    await runSnapshotRecorded('https://github.com/search?q=requests&type=repositories', 'live-map', rec);
    await runSnapshotRecorded('https://github.com/psf/requests', 'live-map', rec);
    rec.stop('live-map');
    const a = analyseObservations(rec.observations('live-map'));
    const gh = a.sites.find((s) => s.node === 'github.com');
    expect(gh).toBeDefined();
    expect(gh!.states.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
```

- [ ] **Step 2: Run it gated (live)**

Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/site-mapping.live.test.ts`
Expected: PASS (needs `playwright-cli` + network). Without the env var it's skipped.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/site-mapping.live.test.ts
git commit -m "test(e2e): gated live site-mapping pipeline (record → analyse)"
```

---

## Task 13: Update STATUS.md + full suite green

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Add a feature note + bump the test count**

In `docs/STATUS.md`, add near the DONE section:

```markdown
### Agent-driven site mapping (DONE)

`dev record-start/record-stop` capture every page an agent browses through
webnav's `use` primitives (url + fingerprint + declared links) into a per-session
buffer; `dev graph-analyse <session>` mechanically clusters those pages into
state-TYPES per site (zero-LLM, data not prose) + cross-site edges; the agent
validates/names the structure and persists it via `dev graph-edit --node --graph`;
`dev graph-show --node` reads it back. CLI now splits into `use` (drive browser +
query map) and `dev` (author the map); existing dev verbs renamed entity-first.
Spec/plan: `docs/superpowers/specs/2026-06-04-agent-driven-site-mapping-design.md`,
`docs/superpowers/plans/2026-06-04-agent-driven-site-mapping.md`.
```

Update the test-count + verb-table at the top to include the new verbs.

- [ ] **Step 2: Build + full suite**

Run: `npm run build`
Expected: tsc succeeds.

Run: `npx vitest run`
Expected: all pass, gated e2e skipped. (If mass `NODE_MODULE_VERSION` failures → `npm rebuild better-sqlite3` first, then re-run.)

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: agent-driven site mapping done"
```

---

## Self-review notes (for the implementer)

- **Zero-LLM line held:** `analyseObservations` emits only mechanical data (labels, fingerprints, urls, counts, declared edges). No prose, no "similar"/"consider", no semantic names. Naming is the agent's job, done via `graph-edit`. A test explicitly asserts no prose field.
- **Fork edges:** `needsInput`+`why` are encoded as `kind:'unclassified'` + a `[needs-input: …]` suffix on `semanticStep` — no schema change, inspectable, and consistent with the existing `unclassified` semantics (webnav doesn't decide; the agent does).
- **The recordable seam (Task 6) is the contract:** only browses that go through webnav (`runSnapshotRecorded`) get recorded. The agent must drive via `use` during a record session — documented in help/STATUS.
- **Cross-site edges** feed the internet graph (`route`/`hop` layer) — the agent can turn them into `node_edges` via `dev edge-add`; this plan surfaces them in analyse output but does not auto-write them (the agent decides — #5a).
- **Breaking change is soft:** `use` is added as a dispatcher; bare verbs still parse, so nothing breaks at once. Docs move to the canonical `use`/`dev` forms.
- **DB path:** CLI verbs use the repo `webnav.db`. Unit tests use `:memory:` via `fromDatabase`. The Task 8 manual check uses a temp path to avoid polluting the real map.
- **Native module:** if vitest mass-fails with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3`.
