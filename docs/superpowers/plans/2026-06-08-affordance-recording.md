# Affordance Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make webnav record observed **action-effects** (full before-page → action → full after-page + computed diff + `navigated` flag) instead of inventing a new state-node per in-page change, and make `graph-analyse` return that raw, **structure-neutral** observation set so the calling agent — not webnav — decides the site's structure.

**Architecture:** Add a `diffSnapshots` mechanical primitive (added/removed nodes between two snapshots). Extend the record buffer with an `appendActionEffect` path + new columns (full before/after snapshots, action, diff, navigated). Add a recording seam that captures before/after around an agent action. Rebuild `graph-analyse` to emit grouped-by-host raw action-effects with NO clustering/state-types. webnav imposes no structure; `graph-edit` (unchanged) writes whatever the agent decides.

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 24 — `cd node_modules/better-sqlite3 && npx node-gyp rebuild` on ABI errors), `better-sqlite3`, vitest, `playwright-cli` for the gated e2e. Reuses `parseSnapshot`/`SnapNode` (`src/playwright/snapshot.ts`), `RecordStore` (`src/mapstore/record.ts`), the `use` browse seam (`src/router/browse.ts`).

**Spec:** `docs/superpowers/specs/2026-06-08-affordance-recording-design.md`

---

## Existing shapes this builds on (verified)

- `SnapNode = { role: string; name: string|null; ref: string|null; url: string|null; raw: string }`; `parseSnapshot(yml): SnapNode[]`.
- `RecordStore` (`src/mapstore/record.ts`): `constructor(path)`/`fromDatabase(db)`, `start/stop/isActive/append/observations`. Current `Observation = { url, fingerprint, declaredLinks }`; table `record_observations(session_id, seq, url, fingerprint, declared_links, captured_at, UNIQUE(session_id,seq))`.
- `analyseObservations(observations): { sites:[{node,states,edges}], crossSiteEdges }` — the CURRENT clustered output to be replaced.
- `runSnapshotRecorded(url, sessionId, recordStore, adapter)` in `src/router/browse.ts` — the current page-recording seam.

---

## File structure

- **Create** `src/explorer/diff.ts` — `diffSnapshots(before, after)` → `{ added, removed }` + `didNavigate(fromUrl, toUrl)`. Pure, mechanical.
- **Modify** `src/mapstore/schema.sql` — add action-effect columns to `record_observations` (idempotent migration).
- **Modify** `src/mapstore/record.ts` — `ActionEffect` type + `appendActionEffect` + `actionEffects()` reader; keep `append`/`observations` for back-compat (migration-safe).
- **Modify** `src/router/browse.ts` — `runActionRecorded(...)` seam: capture before/after around an action, append an ActionEffect.
- **Rewrite** `src/explorer/analyse.ts` — `analyseObservations` returns structure-neutral grouped-by-host action-effects; remove clustering/state-types.
- **Modify** tests across the above; update `tests/explorer/analyse.test.ts` for the new shape; gated e2e `tests/e2e/affordance.live.test.ts`.
- **Modify** `docs/STATUS.md`.

---

## Task 1: `diffSnapshots` + `didNavigate` — TDD

**Files:**
- Create: `src/explorer/diff.ts`
- Test: `tests/explorer/diff.test.ts`

Mechanical set-difference of parsed snapshot nodes (identity = `role|name|ref`), plus a URL-changed predicate. This is the convenience layer over raw before/after; pure, no browser.

- [ ] **Step 1: Write the failing test**

Create `tests/explorer/diff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diffSnapshots, didNavigate } from '../../src/explorer/diff.js';
import type { SnapNode } from '../../src/playwright/snapshot.js';

function n(role: string, name: string | null = null, ref: string | null = null): SnapNode {
  return { role, name, ref, url: null, raw: '' };
}

describe('diffSnapshots', () => {
  it('reports added and removed nodes (identity = role|name|ref)', () => {
    const before = [n('button', 'Add to cart', 'e1'), n('heading', 'Products', 'e0')];
    const after = [n('button', 'Remove', 'e1b'), n('heading', 'Products', 'e0'), n('generic', '1', 'e2')];
    const d = diffSnapshots(before, after);
    expect(d.added.map((x) => x.name)).toEqual(expect.arrayContaining(['Remove', '1']));
    expect(d.removed.map((x) => x.name)).toEqual(['Add to cart']);
  });

  it('empty diff when snapshots are identical', () => {
    const a = [n('link', 'Home', 'e1')];
    const d = diffSnapshots(a, [n('link', 'Home', 'e1')]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe('didNavigate', () => {
  it('true when path or host changes', () => {
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/cart.html')).toBe(true);
    expect(didNavigate('https://x.com/a', 'https://y.com/a')).toBe(true);
  });
  it('false when only query/hash/nothing changes (same page)', () => {
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/inventory.html')).toBe(false);
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/inventory.html#x')).toBe(false);
  });
  it('treats an unparseable url change conservatively as navigation', () => {
    expect(didNavigate('https://x.com/a', 'not a url')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explorer/diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/explorer/diff.ts`:

```typescript
import type { SnapNode } from '../playwright/snapshot.js';

export interface SnapshotDiff { added: SnapNode[]; removed: SnapNode[]; }

const idOf = (n: SnapNode) => `${n.role}|${n.name ?? ''}|${n.ref ?? ''}`;

/** Mechanical set-difference of two parsed snapshots by node identity
 *  (role|name|ref). Pure convenience over the raw snapshots — not a judgment. */
export function diffSnapshots(before: SnapNode[], after: SnapNode[]): SnapshotDiff {
  const beforeIds = new Set(before.map(idOf));
  const afterIds = new Set(after.map(idOf));
  return {
    added: after.filter((n) => !beforeIds.has(idOf(n))),
    removed: before.filter((n) => !afterIds.has(idOf(n))),
  };
}

/** Did the action navigate to a different page? Compares host+pathname only
 *  (query/hash changes are same-page). Unparseable → treat as navigation
 *  (conservative: we'd rather flag a possible nav than hide one). */
export function didNavigate(fromUrl: string, toUrl: string): boolean {
  try {
    const a = new URL(fromUrl), b = new URL(toUrl);
    return a.host !== b.host || a.pathname !== b.pathname;
  } catch {
    return fromUrl !== toUrl;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explorer/diff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/diff.ts tests/explorer/diff.test.ts
git commit -m "feat(explorer): diffSnapshots + didNavigate (mechanical before/after diff)"
```

---

## Task 2: Record buffer — `ActionEffect` storage — TDD

**Files:**
- Modify: `src/mapstore/schema.sql`, `src/mapstore/record.ts`
- Test: `tests/mapstore/record-action.test.ts`

Add action-effect storage WITHOUT breaking the existing `append`/`observations`. New columns are nullable so old rows/usage keep working; a new `appendActionEffect`/`actionEffects` pair handles the new shape. Full snapshots stored raw (no filtering).

- [ ] **Step 1: Add columns to `schema.sql` (idempotent migration in record.ts)**

In `src/mapstore/schema.sql`, change the `record_observations` table to add nullable action-effect columns (keep existing columns; SQLite `CREATE TABLE IF NOT EXISTS` won't alter an existing table, so the migration is done in code — see Step 3). Update the canonical schema for FRESH DBs to:

```sql
CREATE TABLE IF NOT EXISTS record_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  url TEXT NOT NULL, fingerprint TEXT NOT NULL, declared_links TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  from_url TEXT, from_snapshot TEXT, action TEXT, to_url TEXT, to_snapshot TEXT,
  navigated INTEGER, diff TEXT,
  UNIQUE(session_id, seq)
);
```

(`url`/`fingerprint`/`declared_links` stay NOT NULL for the legacy `append`; the new `appendActionEffect` fills them with the after-page values so the row is valid under both shapes.)

- [ ] **Step 2: Write the failing test**

Create `tests/mapstore/record-action.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function store(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}

const SNAP_A = '- button "Add to cart" [ref=e1]';
const SNAP_B = '- button "Remove" [ref=e1b]\n- generic "1" [ref=e2]';

describe('RecordStore action-effects', () => {
  it('appends and reads back a full action-effect (raw snapshots kept)', () => {
    const s = store();
    s.start('sess');
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: SNAP_A,
      action: { role: 'button', name: 'Add to cart', ref: 'e1' },
      toUrl: 'https://x.com/inventory.html', toSnapshot: SNAP_B,
      navigated: false, diff: { added: [{ role: 'button', name: 'Remove', ref: 'e1b', url: null, raw: '' }], removed: [] },
    });
    const fx = s.actionEffects('sess');
    expect(fx).toHaveLength(1);
    expect(fx[0].fromSnapshot).toBe(SNAP_A);     // raw kept, not filtered
    expect(fx[0].toSnapshot).toBe(SNAP_B);
    expect(fx[0].navigated).toBe(false);
    expect(fx[0].action!.name).toBe('Add to cart');
    expect(fx[0].diff.added[0].name).toBe('Remove');
  });

  it('supports a null-action initial landing observation', () => {
    const s = store();
    s.start('sess');
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/', fromSnapshot: '',
      action: null, toUrl: 'https://x.com/inventory.html', toSnapshot: SNAP_A,
      navigated: true, diff: { added: [], removed: [] },
    });
    expect(s.actionEffects('sess')[0].action).toBeNull();
  });

  it('does not record when the session is inactive', () => {
    const s = store();
    s.start('sess'); s.stop('sess');
    s.appendActionEffect('sess', { fromUrl: 'u', fromSnapshot: '', action: null, toUrl: 'u', toSnapshot: '', navigated: false, diff: { added: [], removed: [] } });
    expect(s.actionEffects('sess')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Implement in `record.ts`**

Add the type + migration + methods. Add near the top (after `Observation`):

```typescript
import type { SnapNode } from '../playwright/snapshot.js';
import type { SnapshotDiff } from '../explorer/diff.js';

export interface ActionRef { role: string; name: string | null; ref: string | null; }
export interface ActionEffect {
  fromUrl: string; fromSnapshot: string;
  action: ActionRef | null;
  toUrl: string; toSnapshot: string;
  navigated: boolean; diff: SnapshotDiff;
}
export interface StoredActionEffect extends ActionEffect { seq: number; capturedAt: number; }
```

In the constructor AND `fromDatabase`, after `db.exec(SCHEMA)`, call a `migrate()` that adds the columns if an older DB lacks them:

```typescript
  private migrate(): void {
    const cols: any[] = this.db.prepare('PRAGMA table_info(record_observations)').all();
    const have = new Set(cols.map((c) => c.name));
    for (const [col, type] of [['from_url','TEXT'],['from_snapshot','TEXT'],['action','TEXT'],
      ['to_url','TEXT'],['to_snapshot','TEXT'],['navigated','INTEGER'],['diff','TEXT']] as const) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE record_observations ADD COLUMN ${col} ${type}`);
    }
  }
```

(Call `this.migrate()` in both `constructor` and `fromDatabase` right after the `SCHEMA` exec.)

Add the methods:

```typescript
  appendActionEffect(sessionId: string, fx: ActionEffect, nowMs = Date.now()): void {
    if (!this.isActive(sessionId)) return;
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_observations WHERE session_id=?').get(sessionId);
    this.db.prepare(
      `INSERT INTO record_observations
        (session_id,seq,url,fingerprint,declared_links,captured_at,
         from_url,from_snapshot,action,to_url,to_snapshot,navigated,diff)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sessionId, seq.c,
        fx.toUrl, '[]', '[]', nowMs,                          // legacy NOT NULL cols satisfied by after-page
        fx.fromUrl, fx.fromSnapshot, JSON.stringify(fx.action),
        fx.toUrl, fx.toSnapshot, fx.navigated ? 1 : 0, JSON.stringify(fx.diff));
  }
  actionEffects(sessionId: string): StoredActionEffect[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM record_observations WHERE session_id=? AND from_snapshot IS NOT NULL ORDER BY seq').all(sessionId);
    return rows.map((r) => ({
      fromUrl: r.from_url, fromSnapshot: r.from_snapshot,
      action: JSON.parse(r.action), toUrl: r.to_url, toSnapshot: r.to_snapshot,
      navigated: r.navigated === 1, diff: JSON.parse(r.diff),
      seq: r.seq, capturedAt: r.captured_at,
    }));
  }
```

(Note: `actionEffects` filters `from_snapshot IS NOT NULL` so it returns only action-effect rows, not any legacy page-only rows.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/record-action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing record test (back-compat)**

Run: `npx vitest run tests/mapstore/record.test.ts`
Expected: PASS — the legacy `append`/`observations` still work (new columns are nullable; migration is additive).

- [ ] **Step 6: Commit**

```bash
git add src/mapstore/schema.sql src/mapstore/record.ts tests/mapstore/record-action.test.ts
git commit -m "feat(mapstore): ActionEffect storage (full before/after + diff + navigated)"
```

---

## Task 3: Recording seam — capture before/after around an action — TDD

**Files:**
- Modify: `src/router/browse.ts`
- Test: `tests/router/browse-action.test.ts`

`runActionRecorded`: given a session, a "before" snapshot (the current page), and an action to perform, snapshot after, compute diff + navigated, append an ActionEffect. The agent supplies the action; webnav records its effect. (The browser interface needs a way to read the current URL — use the adapter's existing capabilities; for the fake, pass urls explicitly.)

- [ ] **Step 1: Write the failing test**

Create `tests/router/browse-action.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';

const BEFORE = '- button "Add to cart" [ref=e1]';
const AFTER = '- button "Remove" [ref=e1b]\n- generic "1" [ref=e2]';

// Fake browser: performs the action (no-op) then returns the scripted after-page + url.
function fake(after: string, toUrl: string) {
  return {
    open: async () => '',
    snapshot: async () => after,
    close: async () => '',
    act: async () => {},
    currentUrl: async () => toUrl,
  };
}

describe('runActionRecorded', () => {
  it('records an in-page action-effect (navigated=false, diff captured)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const r = await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
      action: { role: 'button', name: 'Add to cart', ref: 'e1' },
      adapter: fake(AFTER, 'https://x.com/inventory.html') as any,
    });
    expect(r.recorded).toBe(true);
    const fx = rec.actionEffects('s');
    expect(fx).toHaveLength(1);
    expect(fx[0].navigated).toBe(false);
    expect(fx[0].diff.added.map((n) => n.name)).toEqual(expect.arrayContaining(['Remove', '1']));
    expect(fx[0].diff.removed.map((n) => n.name)).toEqual(['Add to cart']);
  });

  it('records a navigation action-effect (navigated=true)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
      action: { role: 'link', name: 'cart', ref: 'e9' },
      adapter: fake('- heading "Your Cart" [ref=e3]', 'https://x.com/cart.html') as any,
    });
    expect(rec.actionEffects('s')[0].navigated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/browse-action.test.ts`
Expected: FAIL — `runActionRecorded` not exported.

- [ ] **Step 3: Implement in `browse.ts`**

Add to the `BrowseAdapter` interface (in `browse.ts`): `act?(ref: string): Promise<void>;` and `currentUrl?(): Promise<string>;`. Then add:

```typescript
import { diffSnapshots, didNavigate } from '../explorer/diff.js';
import type { ActionRef } from '../mapstore/record.js';

export interface RunActionArgs {
  sessionId: string;
  recordStore: RecordStore;
  fromUrl: string;
  fromSnapshot: string;
  action: ActionRef;          // the element the agent fires (its ref drives the click)
  adapter?: BrowseAdapter;
}
export interface ActionRecordedResult { status: 'done' | 'failed'; recorded: boolean; navigated?: boolean; reason?: string; }

/** Perform the agent's action, capture the after-page, record an ActionEffect.
 *  webnav does NOT decide what to fire — the agent supplies `action`; we record
 *  what changed (full before/after + diff + navigated). */
export async function runActionRecorded(args: RunActionArgs): Promise<ActionRecordedResult> {
  const adapter = args.adapter ?? newAdapter();
  try {
    if (args.action.ref) await adapter.act!(args.action.ref);
    const toSnapshot = await adapter.snapshot!();
    const toUrl = adapter.currentUrl ? await adapter.currentUrl() : args.fromUrl;
    const navigated = didNavigate(args.fromUrl, toUrl);
    let recorded = false;
    if (args.recordStore.isActive(args.sessionId)) {
      args.recordStore.appendActionEffect(args.sessionId, {
        fromUrl: args.fromUrl, fromSnapshot: args.fromSnapshot, action: args.action,
        toUrl, toSnapshot, navigated,
        diff: diffSnapshots(parseSnapshot(args.fromSnapshot), parseSnapshot(toSnapshot)),
      });
      recorded = true;
    }
    return { status: 'done', recorded, navigated };
  } catch (e) {
    return { status: 'failed', recorded: false, reason: String(e) };
  }
}
```

(`parseSnapshot` is already imported in `browse.ts`. Do NOT close the adapter here — an action sequence reuses the session; the caller manages the browser lifecycle. This differs from `runSnapshotRecorded`, which is a one-shot.)

Also add `currentUrl()` + `act(ref)` to the real `PlaywrightAdapter` if missing: `act` can reuse `click` (`async act(ref){ return this.click(ref); }`) and `currentUrl` via `eval('() => location.href')` cleaned through the existing eval parse. (Check adapter.ts; `click` exists. Add `currentUrl` using `evalJs`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/browse-action.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/router/browse.ts src/playwright/adapter.ts tests/router/browse-action.test.ts
git commit -m "feat(router): runActionRecorded — capture before/after around an agent action"
```

---

## Task 4: Rebuild `graph-analyse` — structure-neutral — TDD

**Files:**
- Rewrite: `src/explorer/analyse.ts`
- Rewrite: `tests/explorer/analyse.test.ts`

Replace the clustered output with grouped-by-host raw action-effects. NO `states`, NO `state-type`, NO clustering. The anti-regression assertion is that those fields are ABSENT.

- [ ] **Step 1: Rewrite the test**

Replace `tests/explorer/analyse.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { analyseActionEffects } from '../../src/explorer/analyse.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

function fx(p: Partial<StoredActionEffect>): StoredActionEffect {
  return {
    fromUrl: 'https://x.com/a', fromSnapshot: '', action: null,
    toUrl: 'https://x.com/a', toSnapshot: '', navigated: false,
    diff: { added: [], removed: [] }, seq: 0, capturedAt: 0, ...p,
  };
}

describe('analyseActionEffects (structure-neutral)', () => {
  it('groups observations by host, imposes NO structure', () => {
    const r = analyseActionEffects([
      fx({ fromUrl: 'https://github.com/x', toUrl: 'https://github.com/x', navigated: false, seq: 0 }),
      fx({ fromUrl: 'https://github.com/x', toUrl: 'https://pypi.org/p', navigated: true, seq: 1 }),
      fx({ fromUrl: 'https://pypi.org/p', toUrl: 'https://pypi.org/p', navigated: false, seq: 2 }),
    ]);
    expect(r.sites.map((s) => s.node).sort()).toEqual(['github.com', 'pypi.org']);
    // raw observations preserved per host
    const gh = r.sites.find((s) => s.node === 'github.com')!;
    expect(gh.observations).toHaveLength(2);
    // NO imposed structure — these keys must NOT exist (anti-regression for the old model)
    expect(gh).not.toHaveProperty('states');
    expect(gh).not.toHaveProperty('clusters');
    expect((gh.observations[0] as any)).not.toHaveProperty('stateType');
  });

  it('carries navigated + diff through unchanged', () => {
    const r = analyseActionEffects([
      fx({ fromUrl: 'https://x.com/i', toUrl: 'https://x.com/i', navigated: false,
        action: { role: 'button', name: 'Add to cart', ref: 'e1' },
        diff: { added: [{ role: 'button', name: 'Remove', ref: 'e1b', url: null, raw: '' }], removed: [] } }),
    ]);
    const o = r.sites[0].observations[0];
    expect(o.navigated).toBe(false);
    expect(o.action!.name).toBe('Add to cart');
    expect(o.addedSummary).toContain('button "Remove"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explorer/analyse.test.ts`
Expected: FAIL — `analyseActionEffects` not exported (old `analyseObservations` still there).

- [ ] **Step 3: Rewrite `analyse.ts`**

Replace the file contents of `src/explorer/analyse.ts` with:

```typescript
import type { StoredActionEffect, ActionRef } from '../mapstore/record.js';
import type { SnapNode } from '../playwright/snapshot.js';

export interface AnalysedObservation {
  fromUrl: string;
  action: ActionRef | null;
  toUrl: string;
  navigated: boolean;
  addedSummary: string[];     // readable summary of diff.added (raw snapshots stay in the buffer)
  removedSummary: string[];
}
export interface AnalysedSite { node: string; observations: AnalysedObservation[]; }
export interface AnalysisResult { sites: AnalysedSite[]; }

function host(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}
const summarize = (nodes: SnapNode[]) =>
  nodes.map((n) => `${n.role}${n.name ? ` "${n.name}"` : ''}`);

/**
 * Structure-NEUTRAL presentation of recorded action-effects. Groups by host
 * (the only grouping — a convenience), and returns each observation as-is:
 * what page, what action, where it went, whether it navigated, and a readable
 * diff summary. webnav imposes NO structure (no states/clusters/edges) — the
 * calling AGENT reads this and decides the site's structure, then writes it via
 * graph-edit. The full raw snapshots remain in the record buffer for the agent.
 */
export function analyseActionEffects(effects: StoredActionEffect[]): AnalysisResult {
  const byHost = new Map<string, AnalysedObservation[]>();
  for (const e of effects) {
    const h = host(e.toUrl) ?? host(e.fromUrl);
    if (!h) continue;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push({
      fromUrl: e.fromUrl, action: e.action, toUrl: e.toUrl, navigated: e.navigated,
      addedSummary: summarize(e.diff.added), removedSummary: summarize(e.diff.removed),
    });
  }
  const sites = [...byHost.entries()]
    .map(([node, observations]) => ({ node, observations }))
    .sort((a, b) => a.node.localeCompare(b.node));
  return { sites };
}
```

(The old `analyseObservations` + its `AnalysedState`/`AnalysedEdge`/`CrossSiteEdge` exports are removed. If anything imports them, update those imports — see Step 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explorer/analyse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Fix consumers of the old analyse + wire the CLI**

Run: `grep -rn "analyseObservations\|AnalysedState\|AnalysedEdge\|CrossSiteEdge" src tests` — update any consumer. The known one is `src/cli.ts`'s `graph-analyse` dispatch (it calls `analyseObservations` over `observations`). Change it to read `actionEffects` and call `analyseActionEffects`:

In `src/cli.ts`, the `graph-analyse` block: replace
```typescript
    const obs = new RecordStore('webnav.db').observations(args.session);
    const result = analyseObservations(obs);
```
with
```typescript
    const fx = new RecordStore('webnav.db').actionEffects(args.session);
    const { analyseActionEffects } = await import('./explorer/analyse.js');
    const result = analyseActionEffects(fx);
```
(and update the import name from `analyseObservations` → `analyseActionEffects`). Keep the `result.sites.length === 0 → exit 3` guard.

- [ ] **Step 6: Run the full suite + build**

Run: `npx vitest run` — Expected: all pass (any old-analyse consumer fixed).
Run: `npm run build` — Expected: tsc OK (incl. web).

- [ ] **Step 7: Commit**

```bash
git add src/explorer/analyse.ts tests/explorer/analyse.test.ts src/cli.ts
git commit -m "feat(explorer): rebuild graph-analyse structure-neutral (raw action-effects, no clustering)"
```

---

## Task 5: Gated live e2e — record real saucedemo add-to-cart, prove the model

**Files:**
- Create: `tests/e2e/affordance.live.test.ts`

Drive the real adapter: snapshot inventory, click an Add-to-cart, record the effect → assert `navigated:false` + the button-flip diff (the bug that drove this). Gated by `WEBNAV_LIVE=1`.

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/affordance.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { parseSnapshot, findByRoleAndName } from '../../src/playwright/snapshot.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: affordance recording (saucedemo add-to-cart)', () => {
  it('records add-to-cart as an in-page mutation (navigated=false, button flips)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('aff');
    const adapter = new PlaywrightAdapter('aff-' + Date.now());
    await adapter.open('https://www.saucedemo.com/');
    // log in
    const login = parseSnapshot(await adapter.snapshot());
    await adapter.fill(findByRoleAndName(login, 'textbox', 'Username')!.ref!, 'standard_user');
    await adapter.fill(findByRoleAndName(login, 'textbox', 'Password')!.ref!, 'secret_sauce');
    await adapter.click(findByRoleAndName(parseSnapshot(await adapter.snapshot()), 'button', 'Login')!.ref!);
    // on inventory: capture before, click first Add to cart via runActionRecorded
    const beforeSnap = await adapter.snapshot();
    const addBtn = parseSnapshot(beforeSnap).find((n) => n.role === 'button' && n.name === 'Add to cart' && n.ref);
    expect(addBtn).toBeTruthy();
    const fromUrl = await adapter.evalJs('() => location.href');
    const r = await runActionRecorded({
      sessionId: 'aff', recordStore: rec,
      fromUrl: fromUrl.replace(/^"|"$/g, ''), fromSnapshot: beforeSnap,
      action: { role: 'button', name: 'Add to cart', ref: addBtn!.ref! },
      adapter: adapter as any,
    });
    await adapter.close().catch(() => {});
    expect(r.recorded).toBe(true);
    expect(r.navigated).toBe(false);                       // THE point: in-page, not a new page
    const fx = rec.actionEffects('aff')[0];
    expect(fx.diff.added.some((n) => n.name === 'Remove')).toBe(true);  // button flipped
  }, 120_000);
});
```

- [ ] **Step 2: Confirm skipped without flag, then run live**

Run: `npx vitest run tests/e2e/affordance.live.test.ts` — Expected: skipped.
Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/affordance.live.test.ts` — Expected: PASS (needs playwright-cli + network). If the adapter lacks `act`/`currentUrl` wiring used by `runActionRecorded`, this is where it surfaces — fix in Task 3's adapter additions. The KEY assertions: `navigated=false` and a `Remove` button appeared. Do not weaken them.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/affordance.live.test.ts
git commit -m "test(e2e): gated live affordance recording (saucedemo add-to-cart = in-page, not a new page)"
```

---

## Task 6: STATUS.md + full suite green

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Add the feature note**

In `docs/STATUS.md`, add near the site-mapping notes:

```markdown
### Affordance recording — action-effects (DONE, 2026-06-08)

webnav now records observed **action-effects** instead of inventing a state-node
per in-page change: each recorded step is `{ fromUrl, fromSnapshot, action, toUrl,
toSnapshot, navigated, diff }` (full before/after kept; diff + navigated are
mechanical derivations). In-page mutations (saucedemo add-to-cart → button flips
to Remove, URL unchanged) are recorded with `navigated:false` — never a new node,
killing the page=state ambiguity. `graph-analyse` is rebuilt **structure-neutral**:
it returns raw observations grouped by host (NO clustering / state-types) — the
calling AGENT decides the site's structure and writes it via `graph-edit`
(unchanged). webnav stays zero-LLM (the LLM is the caller). `diffSnapshots`,
`runActionRecorded`, and the structure-neutral analyse are unit-tested; the
saucedemo add-to-cart case is verified live. Spec/plan:
`docs/superpowers/specs/2026-06-08-affordance-recording-design.md`,
`docs/superpowers/plans/2026-06-08-affordance-recording.md`.
```

Bump the test-count line.

- [ ] **Step 2: Build + full suite**

Run: `npm run build` — Expected: OK.
Run: `npx vitest run` — Expected: all pass, gated e2e skipped. (ABI error → rebuild better-sqlite3.)

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: affordance recording done"
```

---

## Self-review notes (for the implementer)

- **No imposed structure is the whole point.** `analyseActionEffects` must NOT cluster or emit states/edges. The test asserts the ABSENCE of `states`/`clusters`/`stateType`. If you find yourself adding any "what kind of page is this" logic to analyse, stop — that's the agent's job (#5a).
- **Record reality, filter nothing at capture.** Full `fromSnapshot`/`toSnapshot` are stored raw. The diff/summaries are conveniences layered on top, never a replacement.
- **navigated is observed, not assumed** — `didNavigate` compares host+pathname. add-to-cart stays on the same path → false. That single fact is what fixes the original bug.
- **Back-compat:** the migration is additive (nullable columns); legacy `append`/`observations` keep working. `actionEffects` filters to action-effect rows via `from_snapshot IS NOT NULL`.
- **Adapter wiring:** `runActionRecorded` needs `adapter.act(ref)` (= click) and `adapter.currentUrl()` (= eval `location.href`, cleaned). Add them to `PlaywrightAdapter` in Task 3; the live e2e (Task 5) is the gate that proves they work.
- **The walk is unaffected** — it reads the map the agent writes via `graph-edit`. This increment changes recording + analyse only.
- **Native module:** ABI mass-fail → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
```
