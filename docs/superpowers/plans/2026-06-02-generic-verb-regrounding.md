# webnav Generic Verb Re-grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-ground webnav's CLI on generic verbs that operate over map DATA: add the missing `read <url>` primitive, move admin verbs to a `webnav dev <verb>` namespace, make `recall` data-driven via site-bound Goal records (explicit goal-id, no GitHub literals in the verb), and rewrite the help — with GitHub-repos as the one seeded goal, verified end-to-end.

**Architecture:** webnav stays a zero-LLM TypeScript CLI. The command registry (`src/cli-spec.ts`) is split into consumer vs dev commands. A new `read` verb opens a URL and returns distilled content (reusing `classifyReadiness` + `extractContent`). The `Goal` type/record gains `site`/`entry`/`extractor` fields (idempotent migration), and `recall` reads them + an extractor registry instead of hardcoding GitHub in `live.ts`. Goal selection is an explicit id (the agent picks; webnav does deterministic lookup).

**Tech Stack:** TypeScript (strict), Node 18+, vitest, better-sqlite3, playwright-cli. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-generic-verb-regrounding-design.md`

---

## File structure

- **Modify** `src/cli-spec.ts` — split `COMMANDS` into `CONSUMER_COMMANDS` + `DEV_COMMANDS`; add `read` + `list-goals` specs; rewrite `recall` summary.
- **Modify** `src/cli-help.ts` — top-level help shows consumer verbs + a "dev" pointer; add `webnav dev --help`.
- **Modify** `src/cli.ts` — add `read` handler, `list-goals` handler, `dev` subcommand router; rewire `recall` to take an optional goal-id.
- **Create** `src/router/read.ts` — `readUrl(url, opts)`: open → readiness → extract → distilled result.
- **Create** `src/router/extractors.ts` — the named extractor registry.
- **Modify** `src/mapstore/types.ts` — extend `Goal` with `site`/`entry`/`extractor`.
- **Modify** `src/mapstore/schema.sql` + `src/mapstore/store.ts` — persist + migrate the new Goal columns.
- **Modify** `src/goals/find-battle-tested-repos.ts` — set the new fields on the seeded goal.
- **Modify** `src/router/live.ts` — `runRecallLive` reads entry/extractor from the goal instead of hardcoding.
- **Modify** `docs/STATUS.md` — note the re-grounding.

---

## Task 1: Add the `read <url>` verb — the missing primitive

**Files:**
- Create: `src/router/read.ts`
- Test: `tests/router/read.test.ts`

`read` opens a URL, classifies readiness (escalate, never evade), and returns distilled content via `extractContent`. To stay unit-testable without a browser, `readUrl` takes an injectable `fetchSnapshot` function (the live CLI wires the real adapter).

- [ ] **Step 1: Write the failing test**

Create `tests/router/read.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readUrl } from '../../src/router/read.js';

const READY = `
- heading "Example Domain" [ref=e1]
- paragraph "This domain is for use in illustrative examples." [ref=e2]
- paragraph "More information..." [ref=e3]
- link "More information" [ref=e4]
- heading "Section" [ref=e5]
- paragraph "Body text here for content." [ref=e6]
- list "items" [ref=e7]
- paragraph "Another line of readable content." [ref=e8]`;

const INTERSTITIAL = `
- heading "Just a moment..." [ref=e1]
- paragraph "Checking your browser before accessing." [ref=e2]`;

describe('readUrl', () => {
  it('returns distilled content for a ready page', async () => {
    const r = await readUrl('https://example.com', async () => READY);
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.url).toBe('https://example.com');
    expect(r.content.text).toContain('illustrative examples');
  });

  it('escalates (blocked) on an interstitial — never evades', async () => {
    const r = await readUrl('https://example.com', async () => INTERSTITIAL);
    expect(r.status).toBe('blocked');
  });

  it('--raw returns the full snapshot instead of distilled content', async () => {
    const r = await readUrl('https://example.com', async () => READY, { raw: true });
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.raw).toBe(READY);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/read.test.ts`
Expected: FAIL — module `src/router/read.js` not found.

- [ ] **Step 3: Implement `readUrl`**

First check `classifyReadiness`'s return shape — read `src/router/readiness.ts` to confirm the `Readiness` type (it returns a status like `ready`/`loading`/`interstitial`). Then create `src/router/read.ts`:

```typescript
import { classifyReadiness } from './readiness.js';
import { extractContent, type ContentEvidence } from './extract-content.js';

export type ReadResponse =
  | { status: 'done'; url: string; content: ContentEvidence; raw?: string }
  | { status: 'blocked'; url: string; reason: string }
  | { status: 'failed'; url: string; reason: string };

export interface ReadOpts {
  raw?: boolean;
  queryTerms?: string[];
}

/**
 * Open a URL and return its DISTILLED content (or the raw snapshot with --raw).
 * Zero-LLM: readiness + extraction are deterministic. On a loading/interstitial
 * page we report `blocked` and do NOT evade (principle: detect, never bypass).
 * `fetchSnapshot` is injected so this is unit-testable without a browser.
 */
export async function readUrl(
  url: string,
  fetchSnapshot: (url: string) => Promise<string>,
  opts: ReadOpts = {},
): Promise<ReadResponse> {
  let snapshot: string;
  try {
    snapshot = await fetchSnapshot(url);
  } catch (e) {
    return { status: 'failed', url, reason: String(e) };
  }

  const readiness = classifyReadiness(snapshot);
  if (readiness.status !== 'ready') {
    return { status: 'blocked', url,
      reason: `page not ready (${readiness.status}); webnav does not evade walls` };
  }

  if (opts.raw) {
    return { status: 'done', url, content: extractContent(snapshot, url, opts.queryTerms), raw: snapshot };
  }
  return { status: 'done', url, content: extractContent(snapshot, url, opts.queryTerms) };
}
```

Note: confirm `classifyReadiness` returns an object with a `.status` field whose ready value is `'ready'`. If the actual field/value names differ, adjust the comparison to match — read readiness.ts and use its real shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/read.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/router/read.ts tests/router/read.test.ts
git commit -m "feat(router): read <url> primitive — distilled content, escalates never evades"
```

---

## Task 2: The extractor registry

**Files:**
- Create: `src/router/extractors.ts`
- Test: `tests/router/extractors.test.ts`

A Goal record stores an extractor NAME (string). This registry maps name → the deterministic extractor function. `recall` looks up by name. Adding a site = registering one extractor.

- [ ] **Step 1: Write the failing test**

Create `tests/router/extractors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getExtractor, EXTRACTOR_NAMES } from '../../src/router/extractors.js';

describe('extractor registry', () => {
  it('resolves the github-repo-signals extractor by name', () => {
    const fn = getExtractor('github-repo-signals');
    expect(typeof fn).toBe('function');
  });

  it('lists the known extractor names', () => {
    expect(EXTRACTOR_NAMES).toContain('github-repo-signals');
  });

  it('throws a clear error for an unknown extractor name', () => {
    expect(() => getExtractor('no-such-extractor')).toThrow(/unknown extractor/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/extractors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

First confirm the signature of `extractRepoSignals` (read `src/router/extract.ts` — it is used in `live.ts` as `extractRepoSignals(yml, surface.detail)`, i.e. `(snapshotYaml: string, signals: string[]) => Record<string, unknown>`). Create `src/router/extractors.ts`:

```typescript
import { extractRepoSignals } from './extract.js';

/** A named, deterministic extractor: (snapshotYaml, signalsToPull) -> signal map. */
export type Extractor = (snapshotYaml: string, signals: string[]) => Record<string, unknown>;

// The single seam where a new site's "how to read signals" plugs in. Add a site
// = register one extractor here + seed its Goal record (which names this key).
const REGISTRY: Record<string, Extractor> = {
  'github-repo-signals': extractRepoSignals,
};

export const EXTRACTOR_NAMES = Object.keys(REGISTRY);

/** Resolve an extractor by name; throws on an unknown name (misconfigured goal). */
export function getExtractor(name: string): Extractor {
  const fn = REGISTRY[name];
  if (!fn) throw new Error(`unknown extractor: ${name} (known: ${EXTRACTOR_NAMES.join(', ')})`);
  return fn;
}
```

Note: verify `extractRepoSignals`'s exact signature in `src/router/extract.ts`. If it differs from `(string, string[]) => Record<string, unknown>`, adjust the `Extractor` type to match its real shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/extractors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/router/extractors.ts tests/router/extractors.test.ts
git commit -m "feat(router): named extractor registry (the per-site signal seam)"
```

---

## Task 3: Extend the Goal record with site/entry/extractor (+ migration)

**Files:**
- Modify: `src/mapstore/types.ts`
- Modify: `src/mapstore/schema.sql`
- Modify: `src/mapstore/store.ts`
- Modify: `src/goals/find-battle-tested-repos.ts`
- Test: `tests/mapstore/goal-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/goal-fields.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';

const GOAL = {
  name: 'github-repos', site: 'github.com',
  entry: 'https://github.com/search?q={query}&type=repositories',
  extractor: 'github-repo-signals',
  visit: ['detail'], surface: { detail: ['stars'] }, candidateLimit: 5,
};

describe('Goal record site/entry/extractor', () => {
  it('round-trips the new fields through upsert/get', () => {
    const store = new MapStore(':memory:');
    store.upsertGoal(GOAL);
    const got = store.getGoal('github-repos');
    expect(got?.site).toBe('github.com');
    expect(got?.entry).toContain('{query}');
    expect(got?.extractor).toBe('github-repo-signals');
  });

  it('migrates a legacy goals table that lacks the new columns', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE goals (name TEXT PRIMARY KEY, visit TEXT NOT NULL,
      surface TEXT NOT NULL, candidate_limit INTEGER NOT NULL);`);
    db.prepare('INSERT INTO goals VALUES (?,?,?,?)').run(
      'old', '["detail"]', '{"detail":["stars"]}', 5);
    const store = MapStore.fromDatabase(db); // adds the columns idempotently
    const got = store.getGoal('old');
    expect(got).not.toBeNull();
    expect(got?.site == null).toBe(true); // legacy row: new fields null, no crash
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/goal-fields.test.ts`
Expected: FAIL — `upsertGoal` doesn't accept/persist the new fields; `Goal` type lacks them.

- [ ] **Step 3: Extend the Goal type**

In `src/mapstore/types.ts`, change the `Goal` interface to:

```typescript
export interface Goal {
  name: string;
  site: string | null;                      // owning site/node id; null for legacy rows
  entry: string | null;                     // entry URL/query template, {query} slot
  extractor: string | null;                 // named extractor (registry key)
  visit: string[];                          // state roles/ids to visit per candidate
  surface: Record<string, string[]>;        // stateRole -> signals to extract
  candidateLimit: number;
}
```

- [ ] **Step 4: Add the schema columns + migration + persist**

In `src/mapstore/schema.sql`, change the goals table to:

```sql
CREATE TABLE IF NOT EXISTS goals (
  name TEXT PRIMARY KEY, site TEXT, entry TEXT, extractor TEXT,
  visit TEXT NOT NULL, surface TEXT NOT NULL, candidate_limit INTEGER NOT NULL
);
```

In `src/mapstore/store.ts`, extend the existing `migrate()` method (added for states.node_id) to also add the goals columns idempotently. Add this block inside `migrate()` after the states block:

```typescript
    // goals: add site/entry/extractor if an older DB lacks them.
    const gcols: any[] = this.db.prepare('PRAGMA table_info(goals)').all();
    for (const col of ['site', 'entry', 'extractor']) {
      if (!gcols.some((c) => c.name === col)) {
        this.db.exec(`ALTER TABLE goals ADD COLUMN ${col} TEXT`);
      }
    }
```

Then update `upsertGoal` and `getGoal`. Replace them with (use explicit column names — NOT positional VALUES — so a migrated table with appended columns still writes correctly):

```typescript
  upsertGoal(g: Goal): void {
    this.db.prepare(`INSERT INTO goals (name,site,entry,extractor,visit,surface,candidate_limit)
      VALUES (@name,@site,@entry,@extractor,@visit,@surface,@candidateLimit)
      ON CONFLICT(name) DO UPDATE SET site=@site, entry=@entry, extractor=@extractor,
      visit=@visit, surface=@surface, candidate_limit=@candidateLimit`)
      .run({ name: g.name, site: g.site ?? null, entry: g.entry ?? null,
        extractor: g.extractor ?? null, visit: JSON.stringify(g.visit),
        surface: JSON.stringify(g.surface), candidateLimit: g.candidateLimit });
  }
  getGoal(name: string): Goal | null {
    const r: any = this.db.prepare('SELECT * FROM goals WHERE name=?').get(name);
    return r ? { name: r.name, site: r.site ?? null, entry: r.entry ?? null,
      extractor: r.extractor ?? null, visit: JSON.parse(r.visit),
      surface: JSON.parse(r.surface), candidateLimit: r.candidate_limit } : null;
  }
```

Also add a read for `list-goals` (used in Task 5) — add this method:

```typescript
  allGoals(): Goal[] {
    const rows: any[] = this.db.prepare('SELECT * FROM goals ORDER BY name').all();
    return rows.map((r) => ({ name: r.name, site: r.site ?? null, entry: r.entry ?? null,
      extractor: r.extractor ?? null, visit: JSON.parse(r.visit),
      surface: JSON.parse(r.surface), candidateLimit: r.candidate_limit }));
  }
```

- [ ] **Step 5: Update the seeded goal**

In `src/goals/find-battle-tested-repos.ts`, set the new fields:

```typescript
import type { Goal } from '../mapstore/types.js';

export const FIND_BATTLE_TESTED_REPOS: Goal = {
  name: 'github-repos',
  site: 'github.com',
  entry: 'https://github.com/search?q={query}&type=repositories',
  extractor: 'github-repo-signals',
  visit: ['detail'],
  surface: {
    detail: ['stars', 'forks', 'open_issues', 'open_prs', 'commits',
             'tags', 'last_commit', 'license'],
  },
  candidateLimit: 10,
};
```

NOTE: the goal name changes from `find-battle-tested-repos` to `github-repos` (the spec's goal-id). Search the codebase for the old name string and update references: `grep -rn "find-battle-tested-repos" src tests`. Update each (the constant export name `FIND_BATTLE_TESTED_REPOS` can stay; only the `.name` value + any string literal lookups change). Tests asserting `evidence.goal === 'find-battle-tested-repos'` must become `'github-repos'`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/mapstore/goal-fields.test.ts`
Expected: PASS (2 tests).

Run: `npx tsc --noEmit`
Expected: CLEAN — if any Goal literal elsewhere now lacks site/entry/extractor, TS will flag it; fix those literals (they're nullable, so existing test-goal literals may need `site:null,entry:null,extractor:null` or use the seeded constant).

- [ ] **Step 7: Commit**

```bash
git add src/mapstore/types.ts src/mapstore/schema.sql src/mapstore/store.ts src/goals/find-battle-tested-repos.ts tests/mapstore/goal-fields.test.ts
git commit -m "feat(mapstore): Goal record carries site/entry/extractor (+ migration)"
```

---

## Task 4: Rewire `recall` to be data-driven (read entry/extractor from the goal)

**Files:**
- Modify: `src/router/live.ts`
- Test: `tests/router/live-goal-driven.test.ts`

`runRecallLive` currently hardcodes the GitHub search URL + `extractRepoSignals`. Make it take a goal, resolve `entry` with the query, and use `getExtractor(goal.extractor)`.

- [ ] **Step 1: Write the failing test**

Create `tests/router/live-goal-driven.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveEntry } from '../../src/router/live.js';

describe('resolveEntry', () => {
  it('fills the {query} slot, url-encoded', () => {
    const url = resolveEntry('https://github.com/search?q={query}&type=repositories', 'python retry');
    expect(url).toBe('https://github.com/search?q=python%20retry&type=repositories');
  });

  it('returns the template unchanged when there is no {query} slot', () => {
    expect(resolveEntry('https://example.com/feed', 'ignored')).toBe('https://example.com/feed');
  });
});
```

(We unit-test the pure `resolveEntry` helper; the full live `runRecallLive` is covered by the gated e2e in Task 7, since it needs a browser.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/live-goal-driven.test.ts`
Expected: FAIL — `resolveEntry` not exported.

- [ ] **Step 3: Implement — export `resolveEntry`, make `runRecallLive` goal-driven**

In `src/router/live.ts`, add the pure helper near the top (after imports):

```typescript
/** Fill the {query} slot in a goal's entry template, url-encoding the query. */
export function resolveEntry(entry: string, query: string): string {
  return entry.replace('{query}', encodeURIComponent(query));
}
```

Change `runRecallLive` so it loads the goal and uses its `entry` + `extractor` instead of hardcoded values. Update the signature + body. The current code hardcodes the search URL and `extractRepoSignals`; replace those:

- Add imports at top: `import { getExtractor } from './extractors.js';`
- Change the function to accept an optional `goalName` (defaults to the seeded goal's name `github-repos`):

```typescript
export async function runRecallLive(
  query: string, top: number, dbPath = 'webnav.db', goalName = 'github-repos',
): Promise<RecallResponse> {
  const store = new MapStore(dbPath);
  // Seed the known goals/skeleton if absent (ensureSeeded exists from the graph seed work;
  // if recall is run before any seed, this guarantees the goal record is present).
  const { ensureSeeded } = await import('../graph/seed.js');
  ensureSeeded(store);

  const goal = store.getGoal(goalName);
  if (!goal || !goal.entry || !goal.extractor) {
    return { status: 'failed', reason: `no such goal '${goalName}' (run \`webnav list-goals\`)` } as RecallResponse;
  }
  const extractor = getExtractor(goal.extractor);

  const adapter = new PlaywrightAdapter(`webnav-${Date.now()}`);
  await adapter.open(resolveEntry(goal.entry, query));
  // ... (the existing results-rendering wait + candidate URL prefetch loop, UNCHANGED) ...
```

For the rest of the function, keep the existing results-wait + candidate-URL prefetch + snapshot collection loop EXACTLY as-is, but change the final `recallViaMap(...)` call so `extractSignals` uses the resolved extractor + the goal's surface:

```typescript
  return recallViaMap({
    query, goal: { ...goal, candidateLimit: top }, store, browser,
    extractSignals: (yml) => extractor(yml, goal.surface.detail ?? []),
  });
```

Remove the now-unused hardcoded imports if they're no longer referenced (`extractRepoSignals`, `FIND_BATTLE_TESTED_REPOS`) — but check first: `recallViaMap`/other code may still import them. Only remove from `live.ts` if `live.ts` no longer uses them directly.

IMPORTANT: read the current `src/router/live.ts` fully before editing so the results-wait/prefetch loop is preserved verbatim — only the entry URL and extractor wiring change.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/router/live-goal-driven.test.ts`
Expected: PASS (2 tests).

Run: `npx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 5: Commit**

```bash
git add src/router/live.ts tests/router/live-goal-driven.test.ts
git commit -m "feat(router): recall is data-driven — entry+extractor come from the goal record"
```

---

## Task 5: CLI — split consumer/dev verbs, add `read` + `list-goals`, `dev` namespace

**Files:**
- Modify: `src/cli-spec.ts`
- Modify: `src/cli-help.ts`
- Modify: `src/cli.ts`
- Test: `tests/cli/surface.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/surface.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { topLevelHelp, devHelp } from '../../src/cli-help.js';

describe('CLI surface', () => {
  it('top-level help shows the consumer verbs', () => {
    const h = topLevelHelp();
    for (const v of ['locate', 'read', 'recall', 'search', 'list-goals']) {
      expect(h).toContain(v);
    }
  });

  it('top-level help does NOT list admin verbs (they live under dev)', () => {
    const h = topLevelHelp();
    expect(h).not.toMatch(/^\s+add-node\b/m);
    expect(h).not.toMatch(/^\s+add-edge\b/m);
    expect(h).toContain('webnav dev'); // pointer to the dev namespace
  });

  it('dev help lists the admin verbs', () => {
    const h = devHelp();
    for (const v of ['graph', 'add-node', 'add-edge', 'list', 'describe', 'capture']) {
      expect(h).toContain(v);
    }
  });

  it('recall summary no longer hardcodes GitHub', () => {
    const h = topLevelHelp();
    // recall's line should describe replaying a goal, not "Navigate GitHub"
    expect(h).toMatch(/recall/);
    expect(h).not.toMatch(/Navigate GitHub for a use-case/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/surface.test.ts`
Expected: FAIL — `devHelp` not exported; admin verbs still in top-level.

- [ ] **Step 3: Split the command registry**

In `src/cli-spec.ts`, split `COMMANDS` into two exported arrays. Keep the existing `CommandSpec` objects but reorganize:
- `CONSUMER_COMMANDS`: `locate`, `read` (new), `recall` (summary rewritten), `search`, `route`, `hop`, `list-goals` (new).
- `DEV_COMMANDS`: `list`, `describe`, `graph`, `add-node`, `add-edge`, `capture`.
- Keep `export const COMMANDS = [...CONSUMER_COMMANDS, ...DEV_COMMANDS]` so existing `commandHelp(name)` lookups by name still resolve every verb.

Add the `read` spec:
```typescript
  {
    name: 'read',
    summary: 'Open a URL and return its distilled content (use --raw for the full page snapshot).',
    args: [{ name: 'url', required: true, description: 'The URL to open and read.' }],
    flags: [{ name: '--raw', takesValue: false, description: 'Return the full page snapshot instead of distilled content.' }],
    example: 'webnav read https://github.com/psf/requests',
  },
```
Add the `list-goals` spec:
```typescript
  {
    name: 'list-goals',
    summary: 'List the recall goals webnav knows: id, what it does, and the signals it returns.',
    args: [],
    flags: [],
    example: 'webnav list-goals',
  },
```
Rewrite `recall`'s summary to:
```typescript
    summary: 'Replay the known route for a goal and return an evidence bundle (the agent ranks). Run list-goals for goal ids.',
```
and its args to `[{ name: 'goal', required: false, description: 'Goal id (see list-goals); defaults to github-repos.' }, { name: 'query', required: true, description: 'Search term fed into the goal\\'s entry.' }]`.

- [ ] **Step 4: Update help rendering**

In `src/cli-help.ts`: change `topLevelHelp()` to iterate `CONSUMER_COMMANDS` (not `COMMANDS`), update the tagline to `'webnav — a generic map of the agent-internet: locate places, read pages, recall routes, search the web.'`, and after the consumer command list add:
```typescript
  lines.push('');
  lines.push('Run `webnav dev --help` for teach/inspect/dev tools.');
```
Add a new exported `devHelp()` that renders `DEV_COMMANDS` the same way `topLevelHelp` renders commands (copy the rendering loop, iterate `DEV_COMMANDS`, title line `'webnav dev — teaching & inspection tools (not needed for normal use).'`). Import `CONSUMER_COMMANDS`/`DEV_COMMANDS` from cli-spec.

- [ ] **Step 5: Wire the CLI handlers**

In `src/cli.ts`:
- Add `read` to the parsed-args union + parser: `if (cmd === 'read') return { cmd, url: rest[0], raw: rest.includes('--raw') };`
- `recall` parser now takes optional goal: if `rest` has 2 positionals, first is goal, second is query; if 1, it's the query (goal defaults). Implement:
```typescript
  if (cmd === 'recall') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    const hasGoal = pos.length >= 2;
    const goal = hasGoal ? pos[0] : 'github-repos';
    const query = hasGoal ? pos[1] : pos[0];
    const top = rest.includes('--top') ? Number(rest[rest.indexOf('--top') + 1]) : 10;
    return { cmd, goal, query, top };
  }
```
- Add `list-goals` and `dev` to the parser: `if (cmd === 'list-goals') return { cmd };` and `if (cmd === 'dev') return { cmd, devCmd: rest[0], devRest: rest.slice(1) };`
- Add the `read` handler:
```typescript
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
```
- Add the `list-goals` handler:
```typescript
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
```
- Update the `recall` handler call to pass the goal: `const response = await runRecallLive(args.query, args.top, 'webnav.db', args.goal);`
- Add the `dev` router (dispatches the moved admin verbs). Place near the top of command handling:
```typescript
  if (args.cmd === 'dev') {
    if (!args.devCmd || args.devCmd === '--help' || args.devCmd === '-h') {
      const { devHelp } = await import('./cli-help.js');
      console.log(devHelp());
      return;
    }
    // Re-dispatch the dev verb through the existing handlers by treating it as the command.
    // (Implementation: reparse `[args.devCmd, ...args.devRest]` and run the matching admin handler.)
    process.argv = [process.argv[0], process.argv[1], args.devCmd, ...args.devRest];
    return main(); // re-enter with the admin verb as the top command
  }
```
NOTE: the `dev` re-dispatch above is one viable approach; if re-entering `main()` is awkward in the actual code structure, instead extract the admin-verb handlers into a `runDevCommand(devCmd, devRest)` function and call it. Read `src/cli.ts`'s `main()` structure and choose whichever is cleaner; the REQUIREMENT is that `webnav dev graph`, `webnav dev add-node ...`, etc. run the same logic the old top-level verbs did.

- [ ] **Step 6: Run tests + manual smoke**

Run: `npx vitest run tests/cli/surface.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` → CLEAN.

Run: `npx tsx src/cli.ts --help` → shows consumer verbs + "webnav dev" pointer, NOT add-node/add-edge.
Run: `npx tsx src/cli.ts dev --help` → shows admin verbs.
Run: `npx tsx src/cli.ts list-goals` → prints `[{id:"github-repos",...}]`.
Run: `npx tsx src/cli.ts dev graph` → prints the graph JSON (admin verb still works via dev).

- [ ] **Step 7: Commit**

```bash
git add src/cli-spec.ts src/cli-help.ts src/cli.ts tests/cli/surface.test.ts
git commit -m "feat(cli): generic consumer verbs + read + list-goals; admin verbs under 'webnav dev'"
```

---

## Task 6: Full suite + the `read` verb closes the gh-issues gap (verification)

**Files:**
- Test: none new — verification task.

- [ ] **Step 1: Full build + suite**

Run: `npm run build` → tsc succeeds.
Run: `npx vitest run` → all pass (previous total + the new read/extractors/goal/surface tests), gated e2e skipped.

- [ ] **Step 2: Manually confirm the gap is closed (the task that started this)**

Run (live, needs network + playwright-cli):
`npx tsx src/cli.ts read https://github.com/psf/requests`
Expected: a `{status:"done", url, content:{...}}` JSON with the repo page's distilled content (the open-issue count visible in it) — the single obvious move the agent lacked when it thrashed `locate→recall→search→capture`.

If `read` returns `blocked` due to a render race, that's the readiness check working — re-run; webnav reports honestly rather than evading.

- [ ] **Step 3: Commit (if any verification-driven fixes were needed)**

```bash
git add -A
git commit -m "test: verify read closes the page-read gap; full suite green"
```

(If no fixes were needed, skip the commit.)

---

## Task 7: Gated live e2e — recall still works end-to-end after re-grounding

**Files:**
- Create: `tests/e2e/recall-goal.live.test.ts`

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/recall-goal.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runRecallLive } from '../../src/router/live.js';

const LIVE = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!LIVE)('recall (goal-driven, live)', () => {
  it('github-repos goal returns real repo evidence', async () => {
    const r = await runRecallLive('python retry', 3, ':memory:', 'github-repos');
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.evidence.candidates.length).toBeGreaterThan(0);
    expect(r.evidence.candidates[0]).toHaveProperty('signals');
  }, 120000);
});
```

- [ ] **Step 2: Run gated (skipped) + optionally live**

Run: `npx vitest run tests/e2e/recall-goal.live.test.ts` → 1 skipped.
Optional live: `WEBNAV_LIVE=1 npx vitest run tests/e2e/recall-goal.live.test.ts` → PASS (proves the data-driven recall still navigates GitHub end-to-end). The controller runs this live as the final proof.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/recall-goal.live.test.ts
git commit -m "test(e2e): gated live recall via github-repos goal (re-grounding intact)"
```

---

## Task 8: Update STATUS.md

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update the verbs table + add a note**

In `docs/STATUS.md`, update the verbs section: consumer verbs are now `locate`/`read`/`recall <goal-id>`/`search`/`list-goals`; admin verbs (`graph`/`add-node`/`add-edge`/`list`/`describe`/`capture`) are under `webnav dev`. Add a short note:

```markdown
## Generic verb re-grounding (DONE)

webnav's verbs are now generic operations over map DATA (no website baked into a
verb). Consumer surface: `locate`, `read <url>` (NEW — open a URL, return distilled
content), `recall <goal-id> "<query>"` (data-driven: explicit goal id, site-bound
Goal record carries site/entry/extractor; GitHub-repos is the one seeded goal —
a 2nd site is data-only), `search`, `list-goals`. Admin verbs moved under
`webnav dev`. Adds the missing "go read this page" primitive that previously made
agents thrash. Spec: `docs/superpowers/specs/2026-06-02-generic-verb-regrounding-design.md`.
```

Bump the test-count line (run `npx vitest run`, read the number).

- [ ] **Step 2: Build + suite green**

Run: `npm run build` → succeeds.
Run: `npx vitest run` → all pass, gated e2e skipped.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: generic verb re-grounding done; read verb + dev namespace + data-driven recall"
```

---

## Self-review notes (for the implementer)

- **Sequencing:** Tasks 1–2 (read verb, extractor registry) are independent and ship the capability gap first. Task 3 (Goal record) underpins Task 4 (data-driven recall) and Task 5 (list-goals). Task 5 is the biggest (CLI surface). 6–8 verify + document.
- **Goal name change:** `find-battle-tested-repos` → `github-repos`. Grep both `src` and `tests` for the old string; update lookups + any `evidence.goal ===` assertions. The exported constant name `FIND_BATTLE_TESTED_REPOS` can stay.
- **Explicit column names** in `upsertGoal` (Task 3) — same lesson as the states.node_id migration: a migrated table appends columns last, so positional VALUES would corrupt. Name the columns.
- **`recall` backward-compat:** no-goal-id form (`recall "<query>"`) defaults to `github-repos`, so existing callers/tests keep working.
- **`dev` re-dispatch:** verify `webnav dev <admin-verb>` runs the SAME logic the old top-level verb did. Whether via re-entering main() or an extracted `runDevCommand`, the admin handlers must not be duplicated.
- **Zero-LLM + no-evasion:** `read` reports `blocked` on interstitials (never bypasses); extractors are deterministic; the agent still ranks. Don't add any model calls.
- **Confirm machinery signatures before coding:** `classifyReadiness` return shape (Task 1), `extractRepoSignals` signature (Task 2), and read `live.ts` fully before editing (Task 4) so the results-wait loop is preserved verbatim.
