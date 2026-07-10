# Structure Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot site-tuned heuristics in recording→draft with observation-based inference (five site-agnostic evidence axes), per `docs/superpowers/specs/2026-07-10-structure-inference-design.md`.

**Architecture:** New pure-function module `src/explorer/infer.ts` (URL model, faces, overlay membership, shell, template core, repeat folding) consumed by a rewritten `draftFromEffects` in `src/explorer/draft.ts`. Recorder gains settledness (readiness-gated snapshots) + `requestedUrl` capture. Store gains `provisional` on states, `scope` on affordances, a per-site `_shell` state whose navigate affordances project as from-anywhere edges. Viewer shows shell once + provisional badges.

**Tech Stack:** TypeScript strict, Node 18+, vitest, better-sqlite3, playwright-cli adapter. Zero LLM in webnav (#5a).

**Model assignment (user directive 2026-07-10):** Fable (orchestrator) defines and reviews; execution subagents run on **opus** (Tasks 7–10, 15) or **sonnet** (all other tasks); webnav-DRIVING agents in Task 16 run on **haiku** (repo rule). Each task header names its executor.

## Global Constraints

- **Zero site-specific code in `src/`** — no site hostnames, no site-shaped regexes (e.g. "records found"), no ID-shape guessing as truth. Priors are allowed only if the result is marked `provisional`. (Seed/example data files are exempt: `src/seed*`, `packs/`.)
- **Fix upstream, never patch downstream** (CLAUDE.md HARD RULE): all fixes land in the producing stage; no viewer/graph scrubbing.
- **#5a zero-LLM**: inference is deterministic; anything undecidable is marked and escalated, never guessed silently.
- **The map stores structure, never data values**: no overlay option values, no instance headings as identity, no record counts, no date literals.
- Code style: 2-space indent, single quotes, vitest, existing naming conventions in each file.
- Git: author `dikshant.y` (verify `git config user.name` before first commit). Commit after every task.
- Browsers in tests/validation: **headless only**; one live session at a time; reap after (CLAUDE.md guardrails).
- All work after Task 0 happens on a worktree branch `structure-inference` (superpowers:using-git-worktrees), merged in Task 16.

---

### Task 0: Commit the current verified work (orchestrator: Fable, inline)

The working tree holds the verified session-review-gate + dashboard-restructure + recorder-ergonomics body (~22 modified files + bench/docs). Commit BEFORE branching so the rewrite starts clean.

- [ ] **Step 1:** `git config user.name` → must print `dikshant.y`; if not, set `git config user.name "dikshant.y"` (email accordingly).
- [ ] **Step 2:** Three logical commits on `main`:
  1. `feat(recorder): hover capture, name probe, maximized headed window, pointer overlay` — `src/recorder/agent-session.ts src/recorder/live.ts src/playwright/adapter.ts playwright-cli.json tests/recorder/agent-session.test.ts tests/playwright/adapter.test.ts`
  2. `feat(review-gate): session review verdicts gate graph-analyse; record-rename; multi-session analyse` — `src/mapstore/record.ts src/mapstore/store.ts src/mapstore/types.ts src/explorer/draft.ts src/graph/edit.ts src/cli.ts src/cli-spec.ts tests/mapstore/record.test.ts tests/graph/edit.test.ts tests/explorer/draft.test.ts tests/cli/parse-mapping.test.ts tests/cli-spec.test.ts`
  3. `feat(dashboard): left-pane nav, verdict-first review, three-state badges, light/dark, visual graph` — `src/dashboard/server.ts src/dashboard/shell.ts tests/dashboard/*.test.ts CLAUDE.md docs/superpowers/specs/2026-07-10-structure-inference-design.md bench/`
  (`.webm` files stay untracked; add `take-*.webm` to `.gitignore` in commit 3.)
- [ ] **Step 3:** `npm test` green before each commit; `npx tsc --noEmit` green.
- [ ] **Step 4:** Create worktree branch `structure-inference` for Tasks 1+.

---

### Task 1: Guard test + CLAUDE.md settled guidelines (executor: sonnet)

**Files:**
- Create: `tests/guidelines.test.ts`
- Modify: `CLAUDE.md` (two additions below)

**Interfaces:** none (test + docs only).

- [ ] **Step 1: Write the guard test**

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Pins the settled 2026-07-10 guideline: inference must be site-agnostic.
// A site name appearing in src/ means someone re-introduced a site-tuned rule.
const EXEMPT = /src\/seed/;   // shipped example DATA (saucedemo default seed) is not a rule
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
describe('core guidelines (settled 2026-07-10)', () => {
  const files = tsFiles('src').filter((p) => !EXEMPT.test(p));
  it('no site-specific names in src/', () => {
    const SITES = /the analytics SPA|orangehrm|analytics\.mn|automationexercise/i;
    for (const p of files) expect(SITES.test(readFileSync(p, 'utf8')), p).toBe(false);
  });
  it('no site-shaped one-shot heuristics (deleted 2026-07-10)', () => {
    const BANNED = [/records?\s+found/i, /\bID_SEG\b/, /subTabContainer/];
    for (const p of files) for (const re of BANNED) expect(re.test(readFileSync(p, 'utf8')), `${p} ~ ${re}`).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/guidelines.test.ts` → the `no site-shaped` test FAILS (ID_SEG/subTabContainer still exist — they're deleted in Tasks 9–10). Mark those two expectations `it.todo`-style? NO — instead scope Step 2 honestly: run and record the failures; commit the test with `it.fails` on the second case:

```ts
  it.fails('no site-shaped one-shot heuristics (deleted 2026-07-10)', () => {
```

(`it.fails` inverts: passes while the heuristics still exist, and will FAIL the moment they're deleted — Task 10 flips it back to `it`. This keeps CI green at every commit while pinning the goal.)
- [ ] **Step 3: CLAUDE.md additions.** (a) Append to the `## Subagent model (settled)` section:

```markdown
**Division of labor (settled 2026-07-10):** Fable (the main session) DEFINES (specs, plans, designs) and REVIEWS; implementation/execution subagents run on **Opus** (hard rewrites) or **Sonnet** (mechanical/TDD tasks). The Haiku rule above still governs webnav-USING/TESTING subagents.
```

(b) New section after "Fix upstream, never patch downstream":

```markdown
## Structure inference (settled 2026-07-10 — `2026-07-10-structure-inference-design.md`)

Recording→graph derives structure by OBSERVATION-BASED INFERENCE, never one-shot site-tuned heuristics. Five site-agnostic evidence axes: (1) **settledness** — only readiness-gated landings define a state's face; redirect-chain URLs are aliases, never states; (2) **declaration** — ARIA landmarks declare shell, dialog/menu/listbox declare overlays; a click INSIDE an overlay is a value selection, not a page affordance; (3) **cross-page variance** — nodes on ≥80% of pages = shell, stored once on the `_shell` state (edges project from-anywhere); (4) **cross-visit variance** — a state's core = what repeats across its landings; single-landing states are `provisional` and analyse REPORTS what to record next; (5) **within-page repetition** — ≥3 same-role siblings sharing a name suffix fold to ONE `scope:'row'` affordance. Identity = URL-template × structural-template (propose/dispose). **The map stores structure, never data values** (no option lists, no instance headings, no counts/dates). Enforced by `tests/guidelines.test.ts`.
```

- [ ] **Step 4:** `npm test` → green (guard file passes with `it.fails`). Commit: `test+docs: pin site-agnostic guideline; settle structure-inference + model division in CLAUDE.md`

---

### Task 2: infer.ts — URL model + template proposal (executor: sonnet)

**Files:**
- Create: `src/explorer/infer.ts`
- Create: `tests/explorer/infer.test.ts`

**Interfaces (Produces — later tasks import these exact names):**
```ts
export interface UrlModel { base: string[]; keyOf(url: string): string }
export function inferUrlModel(urls: string[]): UrlModel
export interface TemplateGroup { template: string; keys: string[]; paramPos: number }
export function proposeTemplates(keys: string[]): TemplateGroup[]
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { inferUrlModel, proposeTemplates } from '../../src/explorer/infer.js';

describe('inferUrlModel', () => {
  it('infers a multi-segment base shared by ≥80% of urls and merges base-less redirect ghosts', () => {
    const urls = [
      'https://x.test/v3/9999/report/list', 'https://x.test/v3/9999/report/7001/aa11',
      'https://x.test/v3/9999/dashboard/list', 'https://x.test/v3/9999/dashboard/8001',
      'https://x.test/v3/9999/announcements', 'https://x.test/v3/9999/help-center',
      'https://x.test/v3/report/list',           // pre-redirect ghost: missing tenant
    ];
    const m = inferUrlModel(urls);
    expect(m.base).toEqual(['v3', '9999']);
    expect(m.keyOf('https://x.test/v3/report/list')).toBe('/report/list');       // ghost merges
    expect(m.keyOf('https://x.test/v3/9999/report/list?tab=1#x')).toBe('/report/list'); // query/hash dropped
  });
  it('no base when paths share no constant prefix (github-style)', () => {
    const m = inferUrlModel(['https://g.test/facebook/react', 'https://g.test/trending', 'https://g.test/vuejs/vue']);
    expect(m.base).toEqual([]);
    expect(m.keyOf('https://g.test/facebook/react')).toBe('/facebook/react');
  });
});

describe('proposeTemplates', () => {
  it('groups keys equal in all but one position (slug ids too — no digit/hex regex)', () => {
    const groups = proposeTemplates(['/products/blue-widget', '/products/red-widget', '/cart']);
    expect(groups).toEqual([{ template: '/products/{param}', keys: ['/products/blue-widget', '/products/red-widget'], paramPos: 1 }]);
  });
  it('a group is only PROPOSED — /dashboard/list vs /dashboard/8001 still groups here (disposal is structural, draft-side)', () => {
    const groups = proposeTemplates(['/dashboard/list', '/dashboard/8001']);
    expect(groups[0].template).toBe('/dashboard/{param}');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/explorer/infer.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
import type { SnapNode } from '../playwright/snapshot.js';

// Observation-based inference primitives (settled 2026-07-10, structure-inference design).
// Pure + deterministic; ZERO site knowledge (#5a). Thresholds are documented tunables.

const segsOf = (url: string): string[] => {
  try { return new URL(url).pathname.split('/').filter(Boolean); } catch { return []; }
};

export interface UrlModel { base: string[]; keyOf(url: string): string }

/** Site base = greedy leading segments shared by ≥80% of observed paths (e.g. version+tenant
 *  `v3/1041`). keyOf strips query/hash + the base segments IN ORDER WHERE PRESENT, so a
 *  pre-redirect URL missing the tenant still lands on the same key (the ghost merges). */
export function inferUrlModel(urls: string[]): UrlModel {
  let work = urls.map(segsOf);
  const base: string[] = [];
  for (;;) {
    const nonEmpty = work.filter((p) => p.length);
    if (!nonEmpty.length) break;
    const heads = new Map<string, number>();
    for (const p of nonEmpty) heads.set(p[0], (heads.get(p[0]) ?? 0) + 1);
    const [top, cnt] = [...heads.entries()].sort((a, b) => b[1] - a[1])[0];
    if (cnt < 0.8 * nonEmpty.length) break;
    base.push(top);
    work = work.map((p) => (p[0] === top ? p.slice(1) : p));
  }
  const keyOf = (url: string): string => {
    let p = segsOf(url);
    for (const b of base) if (p[0] === b) p = p.slice(1);
    return '/' + p.join('/');
  };
  return { base, keyOf };
}

export interface TemplateGroup { template: string; keys: string[]; paramPos: number }

/** PROPOSE param templates: keys of equal length differing at exactly one position (≥2 keys).
 *  Purely positional — no digit/hex shape guessing. The caller DISPOSES structurally. */
export function proposeTemplates(keys: string[]): TemplateGroup[] {
  const bySig = new Map<string, { keys: string[]; paramPos: number; parts: string[] }>();
  const parts = keys.map((k) => k.split('/').filter(Boolean));
  for (let i = 0; i < parts.length; i++) {
    for (let pos = 0; pos < parts[i].length; pos++) {
      const sig = parts[i].length + ':' + pos + ':' + parts[i].map((s, j) => (j === pos ? '{param}' : s)).join('/');
      const g = bySig.get(sig) ?? { keys: [], paramPos: pos, parts: parts[i] };
      g.keys.push(keys[i]);
      bySig.set(sig, g);
    }
  }
  return [...bySig.values()].filter((g) => g.keys.length >= 2).map((g) => ({
    template: '/' + g.parts.map((s, j) => (j === g.paramPos ? '{param}' : s)).join('/'),
    keys: g.keys, paramPos: g.paramPos,
  }));
}
```

- [ ] **Step 4:** `npx vitest run tests/explorer/infer.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(infer): URL base + template proposal by variance (no ID regexes)`

---

### Task 3: infer.ts — faces + overlay membership (executor: sonnet)

**Files:**
- Modify: `src/explorer/infer.ts` (append)
- Modify: `tests/explorer/infer.test.ts` (append)

**Interfaces (Produces):**
```ts
export type Face = Set<string>;                          // 'role:name' of NAMED nodes
export function faceOf(nodes: SnapNode[]): Face
export function jaccard(a: Face, b: Face): number
export const OVERLAY_ROLES: ReadonlySet<string>
export function insideOverlay(nodes: SnapNode[], idx: number): boolean
export function nodeIndexByName(nodes: SnapNode[], name: string): number
```

- [ ] **Step 1: Failing tests** (SnapNode fixtures via `parseSnapshot` on YAML-ish literals — same format the recorder stores):

```ts
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { faceOf, jaccard, insideOverlay, nodeIndexByName } from '../../src/explorer/infer.js';

const PAGE_WITH_DIALOG = [
  '- button "Add dimensions" [ref=e1] [cursor=pointer]',
  '- button "Share" [ref=e2]',
  '- dialog [ref=e3]:',
  '  - textbox "Search" [ref=e4]',
  '  - checkbox "Publisher" [ref=e5]',
  '  - checkbox "Country" [ref=e6]',
  '  - button "Apply" [ref=e7]',
  '- button "Run" [ref=e8]',
].join('\n');

describe('faces + overlay membership', () => {
  const nodes = parseSnapshot(PAGE_WITH_DIALOG);
  it('faceOf = role:name set of named nodes', () => {
    expect(faceOf(nodes).has('button:Share')).toBe(true);
    expect(faceOf(nodes).has('dialog:')).toBe(false);          // unnamed containers excluded
  });
  it('jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(1);             // two empty faces are identical
  });
  it('insideOverlay: picker options/controls are inside; openers and page buttons are not', () => {
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Publisher'))).toBe(true);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Apply'))).toBe(true);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Add dimensions'))).toBe(false);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Run'))).toBe(false);   // AFTER the dialog, same depth
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement**

```ts
export type Face = Set<string>;

export function faceOf(nodes: SnapNode[]): Face {
  const f: Face = new Set();
  for (const n of nodes) if (n.name && n.name.trim()) f.add(`${n.role}:${n.name}`);
  return f;
}

export function jaccard(a: Face, b: Face): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Roles that DECLARE a transient overlay container (WAI-ARIA). A node nested under one is
// overlay content (a value being chosen, or the overlay's own controls) — never page structure.
export const OVERLAY_ROLES: ReadonlySet<string> = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip']);

/** Walk ancestors by indent depth (same containment logic shadow.ts uses): the nearest
 *  lower-depth predecessor chain; true if any ancestor's role declares an overlay. */
export function insideOverlay(nodes: SnapNode[], idx: number): boolean {
  if (idx < 0 || idx >= nodes.length) return false;
  let cur = nodes[idx].depth;
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].depth < cur) {
      if (OVERLAY_ROLES.has(nodes[i].role)) return true;
      cur = nodes[i].depth;
    }
  }
  return false;
}

export function nodeIndexByName(nodes: SnapNode[], name: string): number {
  return nodes.findIndex((n) => n.name === name);
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit: `feat(infer): faces, jaccard, declared-overlay membership`

---

### Task 4: infer.ts — shell extraction + template core (executor: sonnet)

**Files:** append to `src/explorer/infer.ts` + `tests/explorer/infer.test.ts`.

**Interfaces (Produces):**
```ts
export function extractShell(faces: Face[], minFrac?: number): Face          // default 0.8
export interface CoreResult { tokens: Face; provisional: string | null }
export function templateCore(landingFaces: Face[]): CoreResult
```

- [ ] **Step 1: Failing tests**

```ts
import { extractShell, templateCore } from '../../src/explorer/infer.js';

describe('extractShell', () => {
  it('nodes on ≥80% of distinct pages are shell', () => {
    const sidebar = ['link:Reports', 'link:Dashboards', 'button:Dark Mode'];
    const faces = [
      new Set([...sidebar, 'heading:Reports', 'button:New Report']),
      new Set([...sidebar, 'heading:Dashboards']),
      new Set([...sidebar, 'heading:Downloads']),
      new Set([...sidebar, 'heading:Help Center']),
      new Set([...sidebar, 'heading:Announcements']),
    ];
    expect(extractShell(faces)).toEqual(new Set(sidebar));
  });
  it('empty when fewer than 4 pages (no shell claim on tiny evidence)', () => {
    expect(extractShell([new Set(['a']), new Set(['a'])])).toEqual(new Set());
  });
});

describe('templateCore', () => {
  it('n≥2: keeps tokens in ≥60% of landings (structure), drops the varying remainder (data)', () => {
    const r = templateCore([
      new Set(['button:Refresh list', 'link:file-aug.csv', 'tab:Owned']),
      new Set(['button:Refresh list', 'link:file-sep.csv', 'tab:Owned']),
    ]);
    expect(r.tokens).toEqual(new Set(['button:Refresh list', 'tab:Owned']));   // rows fell out
    expect(r.provisional).toBeNull();
  });
  it('n=1: keeps everything but marks provisional with an actionable note', () => {
    const r = templateCore([new Set(['heading:Dashboards', 'link:ASJDH'])]);
    expect(r.tokens.size).toBe(2);
    expect(r.provisional).toMatch(/seen once/i);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement**

```ts
/** Shell = tokens present on ≥minFrac of DISTINCT pages. Needs ≥4 pages to claim anything —
 *  on tiny evidence a "shell" would just be coincidence. */
export function extractShell(faces: Face[], minFrac = 0.8): Face {
  if (faces.length < 4) return new Set();
  const count = new Map<string, number>();
  for (const f of faces) for (const t of f) count.set(t, (count.get(t) ?? 0) + 1);
  const shell: Face = new Set();
  for (const [t, c] of count) if (c >= minFrac * faces.length) shell.add(t);
  return shell;
}

export interface CoreResult { tokens: Face; provisional: string | null }

/** A state's durable face = tokens repeating across its settled landings (majority k-of-n,
 *  0.6 — tolerates one A/B-noisy visit in three). ONE landing = no variance signal: keep all,
 *  mark provisional; analyse surfaces the note as a record-next request. */
export function templateCore(landingFaces: Face[]): CoreResult {
  if (landingFaces.length === 1) {
    return { tokens: new Set(landingFaces[0]), provisional: 'seen once — record another visit to separate structure from data' };
  }
  const need = Math.ceil(landingFaces.length * 0.6);
  const count = new Map<string, number>();
  for (const f of landingFaces) for (const t of f) count.set(t, (count.get(t) ?? 0) + 1);
  const tokens: Face = new Set();
  for (const [t, c] of count) if (c >= need) tokens.add(t);
  return { tokens, provisional: null };
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit: `feat(infer): cross-page shell + cross-visit template core with provisional marking`

---

### Task 5: infer.ts — foldRepeats (executor: sonnet)

**Files:** append to `src/explorer/infer.ts` + `tests/explorer/infer.test.ts`.

**Interfaces (Produces):**
```ts
export interface FoldedRepeat { role: string; suffix: string; count: number }
export function foldRepeats(nodes: SnapNode[]): { folds: FoldedRepeat[]; foldedNames: Set<string> }
```

- [ ] **Step 1: Failing tests**

```ts
import { foldRepeats } from '../../src/explorer/infer.js';

describe('foldRepeats', () => {
  it('≥3 same-role same-depth siblings sharing a trailing word with varying prefixes fold to one', () => {
    const nodes = parseSnapshot([
      '- button "OS Remove" [ref=e1]', '- button "Revenue Remove" [ref=e2]',
      '- button "Win Rate Remove" [ref=e3]', '- button "eCPM Remove" [ref=e4]',
      '- button "Share" [ref=e5]',
    ].join('\n'));
    const { folds, foldedNames } = foldRepeats(nodes);
    expect(folds).toEqual([{ role: 'button', suffix: 'Remove', count: 4 }]);
    expect(foldedNames.has('OS Remove')).toBe(true);
    expect(foldedNames.has('Share')).toBe(false);
  });
  it('two repeats do not fold (below evidence threshold)', () => {
    const nodes = parseSnapshot(['- button "A Remove" [ref=e1]', '- button "B Remove" [ref=e2]'].join('\n'));
    expect(foldRepeats(nodes).folds).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement**

```ts
export interface FoldedRepeat { role: string; suffix: string; count: number }

/** ≥3 same-role, same-depth nodes whose names share a common trailing word (with DISTINCT
 *  varying prefixes) are one value-bound affordance repeated per row/chip — fold to a single
 *  scope:'row' template. Evidence-only: repetition IS the signal, no meaning guessed. */
export function foldRepeats(nodes: SnapNode[]): { folds: FoldedRepeat[]; foldedNames: Set<string> } {
  const groups = new Map<string, string[]>();   // role|depth|lastWord → full names
  for (const n of nodes) {
    if (!n.name || !n.name.trim()) continue;
    const words = n.name.trim().split(/\s+/);
    if (words.length < 2) continue;             // need a prefix + suffix
    const key = `${n.role}|${n.depth}|${words[words.length - 1]}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n.name);
  }
  const folds: FoldedRepeat[] = [];
  const foldedNames = new Set<string>();
  for (const [key, names] of groups) {
    const distinct = new Set(names);
    if (distinct.size < 3) continue;
    const [role, , suffix] = key.split('|');
    folds.push({ role, suffix, count: distinct.size });
    for (const nm of distinct) foldedNames.add(nm);
  }
  return { folds, foldedNames };
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** `npm test` (whole suite still green). Commit: `feat(infer): fold repeated value-bound siblings into one row-scoped template`

---

### Task 6: recorder settledness + requestedUrl (executor: sonnet)

**Files:**
- Modify: `src/mapstore/record.ts` (ActionEffect + column + read/write)
- Modify: `src/recorder/agent-session.ts:123-138` (navigate handler)
- Modify: `src/router/browse.ts:130+` (`runActionRecorded` navigated branch — same settle gate)
- Test: `tests/mapstore/record.test.ts`, `tests/recorder/agent-session.test.ts`

**Interfaces (Produces):** `ActionEffect` gains `requestedUrl?: string` (optional — old rows/readers unaffected). Recorder navigate effects now carry it; `toUrl`/`toSnapshot` are read AFTER a bounded readiness settle.

- [ ] **Step 1: Failing test — record roundtrip** (append to `tests/mapstore/record.test.ts`, mirroring its existing style):

```ts
it('persists requestedUrl on effects and returns it from effectsOf', () => {
  store.startSession('s-req');
  store.appendActionEffect('s-req', {
    fromUrl: 'https://x.test/a', fromSnapshot: '- heading "A"', action: null,
    toUrl: 'https://x.test/v3/1/b', toSnapshot: '- heading "B"', navigated: true,
    diff: { added: [], removed: [] }, requestedUrl: 'https://x.test/v3/b',
  });
  expect(store.effectsOf('s-req')[0].requestedUrl).toBe('https://x.test/v3/b');
});
```

- [ ] **Step 2:** Run → FAIL (type error / undefined). **Step 3: Implement in record.ts:** add `requestedUrl?: string;` to `ActionEffect`; add migration in `migrate()` following the existing pattern: `try { this.db.exec('ALTER TABLE record_observations ADD COLUMN requested_url TEXT'); } catch { /* exists */ }`; write it in `appendActionEffect` and read it in `effectsOf` (nullable column → `requestedUrl: row.requested_url ?? undefined`). Follow the exact existing column plumbing style in that file.
- [ ] **Step 4: Failing test — agent-session settle + requestedUrl** (append to `tests/recorder/agent-session.test.ts`, using its existing fake-deps harness):

```ts
it('navigate: settles (retries a loading snapshot) and records requestedUrl', async () => {
  // first snapshot after goto is a sparse loading shell; second is the real page
  const snaps = ['- generic "spinner"', '- heading "Reports"\n- button "New Report"\n- link "Dashboards"\n- link "Downloads"\n- link "Help"\n- link "Announcements"\n- button "Search"\n- button "Refresh"\n- button "Sort"'];
  let snapCall = 0;
  const deps = makeDeps({   // reuse the file's existing deps builder
    snapshot: async () => snaps[Math.min(snapCall++, 1)],
    currentUrl: async () => 'https://x.test/v3/9999/report/list',
  });
  await drive(deps, [{ cmd: 'navigate', url: 'https://x.test/v3/report/list' }, { cmd: 'quit' }]);
  const eff = deps.effects[0];
  expect(eff.requestedUrl).toBe('https://x.test/v3/report/list');
  expect(eff.toUrl).toBe('https://x.test/v3/9999/report/list');
  expect(eff.toSnapshot).toContain('New Report');   // the SETTLED snapshot, not the spinner
});
```

(Adapt `makeDeps`/`drive` to the harness actually present in that test file — read it first; if helpers are named differently, use those. The assertions are the contract.)
- [ ] **Step 5:** Run → FAIL. **Step 6: Implement in agent-session.ts** navigate branch (replace lines 127-135):

```ts
          await deps.adapter.goto(c.url);
          await deps.adapter.evalJs(OVERLAY_ON_JS).catch(() => {});   // best-effort: video overlay
          // SETTLE before reading url+snapshot: a client-side redirect/late render otherwise
          // records a transient URL as a page (the ghost-state class of bugs). Bounded retry.
          let toSnapshot = await deps.adapter.snapshot();
          for (let i = 0; i < 3 && classifyReadiness(toSnapshot) === 'loading'; i++) {
            await new Promise((r) => setTimeout(r, 700));
            toSnapshot = await deps.adapter.snapshot();
          }
          const toUrl = await deps.adapter.currentUrl();
          if (deps.store.isActive(deps.sessionId)) {
            deps.store.appendActionEffect(deps.sessionId, {
              fromUrl: fromUrl || c.url, fromSnapshot, action: null,
              toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] },
              requestedUrl: c.url,
            });
```

Import: `import { classifyReadiness } from '../router/readiness.js';` (readiness.ts only imports playwright/snapshot — no cycle).
- [ ] **Step 7: browse.ts `runActionRecorded`:** read the navigated branch; apply the same 3×700ms settle loop before its post-action `snapshot()`/URL read (exact insertion point depends on its current structure — the invariant: **`toUrl`+`toSnapshot` are read post-settle**). Add a test in the pattern of existing browse tests if the file has them; otherwise the agent-session test above covers the shared behavior via `runActionRecorded`'s caller.
- [ ] **Step 8:** `npm test` → green. Commit: `feat(recorder): settle before capture; record requestedUrl for alias inference`

---

### Task 7: draft rewrite I — identity, landings, aliases, naming (executor: opus)

**Files:**
- Modify: `src/explorer/draft.ts` (replace the page-keying section, lines ~89-183: `pathSlug`, `ID_SEG`, `stablePathKey`, `ensurePage`, union logic)
- Test: `tests/explorer/draft.test.ts` (replace tests pinning old keying; keep still-valid ones)

**Interfaces:**
- Consumes: `inferUrlModel`, `proposeTemplates`, `faceOf`, `jaccard`, `templateCore` from `./infer.js`; `classifyReadiness` from `../router/readiness.js`.
- Produces (for Tasks 8–10): internal `PageInfo` becomes `{ key: string; url: string; template: string | null; label: string; landings: SnapNode[][]; faces: Face[]; core: Face; coreNodes: SnapNode[]; provisional: string | null }`; `DraftState` gains `provisional?: string | null`; `DraftGraph.receipt` gains `requests: string[]`. **`stablePathKey` is deleted as an export** — check `grep -rn stablePathKey src tests` and update the one draft.test import.

Rules to implement (each is a test):
1. **Keying:** `model = inferUrlModel(all from/to/requested urls)`; alias map from navigated effects with `requestedUrl` where `model.keyOf(requestedUrl) !== model.keyOf(toUrl)`; `key(url) = alias.get(model.keyOf(url)) ?? model.keyOf(url)`.
2. **Landings only:** a page's `landings` = `toSnapshot` of navigated effects (plus the first effect's `fromSnapshot`) **where `classifyReadiness(snap) === 'ready'`**. Non-navigated `toSnapshot`s are NOT unioned into the page (they feed affordance analysis in Task 9 only).
3. **Propose/dispose:** for each `proposeTemplates` group over the observed keys: merge member keys into one page iff every member's first landing face has `jaccard ≥ 0.5` with the group's first member's face; the merged page's `template` = group template, `urlPattern` = first observed full URL. `/dashboard/list` vs `/dashboard/8001` must NOT merge; three `/report/7001/{viz}` variants MUST merge.
4. **SPA split:** within one key, single-link cluster the landing faces at `jaccard ≥ 0.5`; >1 cluster → split into separate states named `<label>` + `-` + slug of a heading token unique to that cluster; a cluster with no distinguishing heading goes to `needsFix` (`reason: 'same-url state with no distinguishing heading'`).
5. **Core:** `templateCore(faces)` minus shell (shell arrives Task 8 — until then minus `new Set()`); `coreNodes` = first landing's nodes filtered to core tokens (keep `SnapNode` order/depth).
6. **Naming:** label = slug of the non-`{param}` tail segments (up to 2) of `template ?? key`; `'/'` → `'home'`. Collision: append the first core `heading:` token slug that distinguishes; still colliding → both to `needsFix` (`reason: 'name collision unresolved'`). **The `-2` counter is deleted.**

- [ ] **Step 1: Failing tests** (representative — write all six):

```ts
it('merges a pre-redirect ghost via requestedUrl alias + base inference (no report-list-2)', () => {
  const effects = [
    nav('https://x.test/v3/9999/dashboard/list', LIST_SNAP),          // helper: navigated effect
    nav('https://x.test/v3/9999/announcements', ANN_SNAP),
    nav('https://x.test/v3/9999/help-center', HELP_SNAP),
    nav('https://x.test/v3/9999/download/list', DL_SNAP),
    { ...nav('https://x.test/v3/9999/report/list', REPORTS_SNAP), requestedUrl: 'https://x.test/v3/report/list' },
  ];
  const g = draftFromEffects(effects as never);
  const labels = g.states.map((s) => s.label);
  expect(labels).toContain('report-list');
  expect(labels.join(',')).not.toMatch(/-2\b/);
});
it('splits same-URL states by structure (SPA) and merges same-structure param URLs', /* rule 3+4 */);
it('a single-landing state carries provisional and surfaces in receipt.requests', /* rule 2+core */);
it('a loading (unready) landing never defines a page face', /* rule 2 */);
```

Snapshot fixture constants (`LIST_SNAP` etc.) are YAML-ish literals ≥9 named nodes each (so `classifyReadiness` = ready; check its `minNodes` default of 8) with a shared 5-link sidebar + distinct headings — define once at the top of the test file.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement rules 1–6 inside `draftFromEffects`, deleting `pathSlug`/`ID_SEG`/`stablePathKey`/the union `mergeNodes` block. Keep `isErrorLanding` (degenerate pass A), `candidateTokens`, `COMMIT_WORDS`, `sameTarget`, the hierarchy pass, self-verify, and `needsFix` assembly — they survive (some are re-pointed in Tasks 8–10).
- [ ] **Step 4:** Run draft tests → PASS; `npm test` → the OLD draft tests pinning deleted behavior fail — replace each with its new-behavior counterpart (list them in the commit body).
- [ ] **Step 5:** Commit: `feat(draft): joint URL×structure identity, alias merging, settled landings, provisional cores`

---

### Task 8: draft rewrite II — shell state + hierarchy + mesh via aliases (executor: opus)

**Files:** `src/explorer/draft.ts`; `tests/explorer/draft.test.ts`.

**Interfaces:**
- Consumes: `extractShell` (Task 4), `key()`/aliases (Task 7).
- Produces: a `_shell` DraftState (`role: 'shell'`, label `_shell`) when `extractShell` over the pages' union-faces is non-empty; ordinary states carry NO shell-link navigate affordances; hierarchy `isSidebarLink(label)` = `shell.has('link:'+label) || /\b(logo|home)\b/i.test(label)` (the ≥60% recount at lines 369-376 is deleted).

Rules:
1. Shell = `extractShell(pages.map(unionFace))`; subtract shell from every state's core.
2. `_shell` state: affordances = for each shell `link:X` whose landing-observed href keys (via alias) to a known page → `{kind:'navigate', to: thatLabel, elementFp: {role:'link', name: X, near: null}}`; other shell tokens (buttons/inputs) → mutate/input affordances with `COMMIT_WORDS` flagging. `urlPattern` = origin of the first URL; `fingerprint: []`.
3. Cross-link mesh (existing 3b block): match link targets through `key()`+aliases (not raw `sameTarget` only) — this is the OrangeHRM href≠landing fix; **skip links whose label is in shell** (they live on `_shell` now).
4. Hierarchy: replace `linkPageCount`/`sidebarCut` with the shell test; `role`/`parentState` logic otherwise unchanged; `_shell` is excluded from hierarchy and from `receipt.states`.

- [ ] **Step 1: Failing tests**

```ts
it('extracts a _shell state once; page states carry no sidebar-duplicate affordances', () => {
  const g = draftFromEffects(FIVE_PAGE_EFFECTS as never);   // fixture from Task 7 with 5-link sidebar
  const shell = g.states.find((s) => s.label === '_shell')!;
  expect(shell.role).toBe('shell');
  expect(shell.affordances.some((a) => a.kind === 'navigate' && a.to === 'download-list')).toBe(true);
  const reports = g.states.find((s) => s.label === 'report-list')!;
  expect(reports.affordances.filter((a) => a.kind === 'navigate' && a.to === 'download-list')).toHaveLength(0);
});
it('mesh resolves a link whose href differs from the landed URL via alias (redirect case)', /* rule 3 */);
it('hierarchy: shell-linked pages are sections; content-linked pages are details (as before)', /* rule 4 */);
```

- [ ] **Steps 2-4:** FAIL → implement → PASS (whole suite; update any old sidebar-mesh tests to the shell model).
- [ ] **Step 5:** Commit: `feat(draft): site shell state (stored once), alias-aware mesh, shell-based hierarchy`

---

### Task 9: draft rewrite III — affordance synthesis (overlay gate, children, folds, core-only interior) (executor: opus)

**Files:** `src/explorer/draft.ts`; `tests/explorer/draft.test.ts`.

**Interfaces:**
- Consumes: `insideOverlay`, `nodeIndexByName`, `foldRepeats` (Tasks 3/5); `coreNodes` (Task 7).
- Produces: `DraftAffordance` gains `scope?: 'row'`.

Rules (each a test):
1. **Recorded click page-gate:** a non-navigated action whose named node is `insideOverlay(fromNodes, idx)` emits NO page affordance (its structure is already the opener's `children`).
2. **Reveal children de-valued:** children from `diff.added` drop members of `foldRepeats(addedNodes).foldedNames` (the value list) and keep unique controls (Search/Apply/Cancel/View All) — same `REVEAL_CHILD_ROLES` filter as today.
3. **Interior synthesis over `coreNodes` only** (was: the union) — and skip `foldedNames`.
4. **Folds become one affordance each:** `{ id, label: fold.suffix, kind: childKind(fold.role), scope: 'row', elementFp: null }` — informational repertoire; mutates never route (#affordance model), so no resolution is needed; self-verify skips affordances with null `elementFp` (already does).
5. Input/type actions get the same overlay gate (a picker's search box is the reveal's child, not a page input).

- [ ] **Step 1: Failing tests**

```ts
it('a click on an option inside a dialog does not become a page affordance', () => {
  const eff = [
    nav('https://x.test/report/9', REPORT_SNAP),
    click('Add dimensions', REPORT_SNAP, REPORT_WITH_DIALOG_SNAP),   // opener: reveal w/ children
    click('Publisher', REPORT_WITH_DIALOG_SNAP, REPORT_WITH_DIALOG_SNAP), // inside dialog
  ];
  const s = draftFromEffects(eff as never).states.find((x) => x.label === 'report')!;
  expect(s.affordances.some((a) => a.label === 'Publisher')).toBe(false);
  const opener = s.affordances.find((a) => a.label === 'Add dimensions')!;
  expect(opener.kind).toBe('reveal');
  expect((opener.children ?? []).some((c) => c.label === 'Publisher')).toBe(false);  // value list folded OUT
  expect((opener.children ?? []).some((c) => c.label === 'Apply')).toBe(true);       // overlay control kept
});
it('≥3 "<X> Remove" chips in core synthesize ONE scope:row affordance labeled Remove', /* rule 4 */);
it('interior synthesis reads core nodes only — a value visible in one landing does not synthesize', /* rule 3 */);
```

- [ ] **Steps 2-4:** FAIL → implement → PASS (suite green; old picker-affordance tests replaced).
- [ ] **Step 5:** Commit: `feat(draft): overlay-gated affordances, folded row templates, core-only interior synthesis`

---

### Task 10: draft rewrite IV — fingerprints from core, shadow from core, requests; delete remaining heuristics (executor: opus)

**Files:** `src/explorer/draft.ts`, `src/explorer/shadow.ts`; `tests/explorer/draft.test.ts`, `tests/explorer/shadow.test.ts`, `tests/guidelines.test.ts` (flip `it.fails` → `it`).

Rules:
1. **Fingerprints:** `candidateTokens(coreNodes)` (never shell, never data slots); exclusivity checked against other states' landing FACES (`face.has(token)`). On a parameterized page (`template` has `{param}`), `heading:` tokens move to the END of candidates; if the final fingerprint still contains only headings → append to the state's provisional note: `'identity rests on a heading that may be instance data — record a different {param} instance'`.
2. **Shadow:** `extractShadow(coreNodes)`; in shadow.ts delete `RECORD_COUNT_RE` + `recordCount` extraction (a count is data) and the whole `subTabContainer`/`ShadowOpts` mechanism (site-specific container names); `filters` skip controls that are `insideOverlay`.
3. **Requests:** `receipt.requests = states.filter(s => s.provisional).map(s => s.label + ': ' + s.provisional)`.
4. Flip the guard test to `it(...)` — the banned heuristics are now gone; it must PASS.

- [ ] **Step 1: Failing tests**

```ts
it('fingerprint never contains a token absent from the multi-landing core (no user-name identity)', () => {
  // two landings of /dashboard/7: same skeleton, DIFFERENT big heading (Demo User vs Q3 Board)
  const g = draftFromEffects([nav(D1_URL, DASH_A), nav(D1_URL, DASH_B)] as never);
  const dash = g.states.find((s) => s.label === 'dashboard')!;
  expect(dash.fingerprint.join()).not.toContain('Demo User');
});
it('single-instance param page: heading-only fingerprint appends the instance-data warning', /* rule 1 */);
it('shadow carries no recordCount and no overlay-enumerated filters', /* rule 2 */);
it('receipt.requests lists each provisional state with its note', /* rule 3 */);
```

- [ ] **Steps 2-4:** FAIL → implement → PASS. Flip guard test; `npm test` fully green; `npx tsc --noEmit` green.
- [ ] **Step 5:** Commit: `feat(draft): core-derived fingerprints + shadow, analyse requests; delete last one-shot heuristics`

---

### Task 11: store/types/edit/walk — shell role, provisional, scope, from-anywhere edges (executor: sonnet)

**Files:**
- Modify: `src/mapstore/types.ts` (StateRole += `'shell'`; `State.provisional: string | null`; `Affordance.scope?: 'row'`; `makeState` defaults `provisional: null`)
- Modify: `src/mapstore/schema.sql` + `src/mapstore/store.ts` (additive migration `ALTER TABLE states ADD COLUMN provisional TEXT` following the exact `parent_state` migration pattern; `upsertState`/`rowToState` carry it; **`edgesFrom(from)`**: after the existing projection, if a state with id `${nodeId}:_shell` exists and `from` isn't it, also project ITS navigate affordances as edges with `fromState = from`)
- Modify: `src/graph/edit.ts` (`EditState.provisional?: string | null`; `EditAffordanceObj.scope?: 'row'`; role passthrough accepts `'shell'`; merge keeps prior-wins semantics)
- Test: `tests/mapstore/*.test.ts`, `tests/graph/edit.test.ts` + a router test asserting `path.ts` finds a route whose edge lives on `_shell`.

- [ ] **Step 1: Failing tests**

```ts
it('edgesFrom projects _shell navigate affordances as from-anywhere edges', () => {
  store.upsertState(makeState({ id: 'x.test:_shell', nodeId: 'x.test', semanticName: '_shell', urlPattern: 'https://x.test', role: 'shell', fingerprint: [], affordances: [makeAffordance({ id: 'a1', label: 'Reports', kind: 'navigate', toState: 'x.test:report-list' })] }));
  store.upsertState(makeState({ id: 'x.test:report-list', nodeId: 'x.test', semanticName: 'report-list', urlPattern: 'https://x.test/report/list', role: 'section', fingerprint: ['heading:Reports'] }));
  store.upsertState(makeState({ id: 'x.test:downloads', nodeId: 'x.test', semanticName: 'downloads', urlPattern: 'https://x.test/download/list', role: 'section', fingerprint: ['heading:Downloads'] }));
  const edges = store.edgesFrom('x.test:downloads');
  expect(edges.some((e) => e.toState === 'x.test:report-list' && e.fromState === 'x.test:downloads')).toBe(true);
});
it('provisional persists through upsertState/getState round-trip', /* column */);
it('editGraph accepts role shell + scope row + provisional and merge keeps prior', /* edit */);
it('findRoute crosses a shell edge (route exists from a page with no own edge)', /* path.ts via store above */);
```

- [ ] **Steps 2-4:** FAIL → implement → PASS. **Step 5:** Commit: `feat(store): shell role + from-anywhere shell edges; provisional + row scope persisted`

---

### Task 12: cli + cli-spec passthrough (executor: sonnet)

**Files:** `src/cli.ts`, `src/cli-spec.ts`; `tests/cli-spec.test.ts`, `tests/cli/parse-mapping.test.ts`.

`graph-analyse` already prints the DraftGraph → `receipt.requests` and `provisional` ride along; verify and pin. `graph-edit` accepts the new fields via Task 11. Update `graph-analyse`/`graph-edit` help text to mention: provisional states, `requests` (what to record next), the `_shell` state.

- [ ] **Step 1:** Failing test: cli-spec help text for `graph-analyse` contains `requests` and `provisional` (mirror existing help-text tests in `tests/cli-spec.test.ts`).
- [ ] **Steps 2-4:** FAIL → edit spec strings → PASS. **Step 5:** Commit: `docs(cli): surface provisional/requests + shell in analyse/edit help`

---

### Task 13: dashboard viewer — shell card, provisional badge, param display, actions expander (executor: sonnet)

**Files:** `src/dashboard/shell.ts`; `tests/dashboard/shell.test.ts`.

Four changes inside `SHELL_HTML` (mind the known escaping traps: NO backticks in comments, double-escape regex backslashes):
1. `graphView`/Sites tree: skip the `_shell` node in the layered tree; render one **"Site shell"** card above the graph listing its affordances (label + kind chip).
2. State card/panel: when `state.provisional` is set → grey badge `◌ Seen once` with `title` = the provisional note; the detail panel shows the note text in full.
3. `urlPattern` containing `{param}` renders verbatim (it's a template — do not linkify).
4. KEY ACTIONS panel: replace the dead `+N more` chip with a `<button class="morebtn">` that toggles the full list (wrap, don't crop — user rule); provisional/scope-`row` affordances render with a `per row` suffix chip.

- [ ] **Step 1: Failing tests** (string-contract style, matching the existing shell.test.ts):

```ts
it('Sites view renders the shell once and badges provisional states', () => {
  expect(SHELL_HTML).toContain('Site shell');
  expect(SHELL_HTML).toContain('Seen once');
  expect(SHELL_HTML).toContain("=== '_shell'");   // the skip guard in graphView
});
it('key-actions +N more is a real toggle, not a dead chip', () => {
  expect(SHELL_HTML).toContain('morebtn');
  expect(SHELL_HTML).not.toMatch(/\+\d+ more<\/span>/);
});
```

- [ ] **Steps 2-4:** FAIL → implement → PASS (`npm test`). **Step 5:** Commit: `feat(dashboard): shell card, provisional badges, template display, expandable actions`

---

### Task 14: review-flow audit (executor: sonnet)

**Files:** read-only over the review verb path (`src/cli.ts` review handler, the review prompt text, `src/mapstore/record.ts` setReview); Modify: `docs/STATUS.md` (append assessment).

The video-review checks capture completeness (video vs logged steps) — orthogonal to inference. Audit questions: (1) does the review prompt/rubric reference anything Tasks 7–10 deleted (unions, page keys, `-2` names)? (2) does the approval gate still key on session ids the renamed flow produces? (3) should review ALSO gate on `requests` — NO (that's analyse's refine loop, keep concerns separate — record this reasoning). Deliverable: a dated "Review-flow audit" note in STATUS.md stating findings + any prompt fix applied (only if (1)/(2) found something).

- [ ] **Step 1:** Read the review prompt + gate code; run `npx vitest run tests/mapstore/record.test.ts` as regression.
- [ ] **Step 2:** Write the STATUS.md note; apply a fix ONLY if the audit found a stale reference (with a test).
- [ ] **Step 3:** Commit: `docs(status): review-flow audit vs structure-inference (findings + reasoning)`

---

### Task 15: offline acceptance on real the analytics SPA data (executor: opus)

**Files:** Create `tests/acceptance/the analytics SPA-local.test.ts`.

Env-gated: `describe.skipIf(!existsSync(join(homedir(), '.webnav/webnav.db')))` — runs on the dev machine, skips in CI. Loads the 5 real sessions' effects via `RecordStore.effectsOf` and runs `draftFromEffects`:

```ts
const SESSIONS = ['reports-list', 'sidebar-nav', 'report-builder', 'dashboard-download-lists', 'dashboard-viewer'];
it('the analytics SPA acceptance: the real 5-session map is clean', () => {
  const effects = SESSIONS.flatMap((s) => store.effectsOf(s));
  const g = draftFromEffects(effects);
  const labels = g.states.map((s) => s.label);
  expect(labels).toContain('report-list');
  expect(labels.join(',')).not.toMatch(/-2\b/);                          // no ghost suffix
  const all = g.states.flatMap((s) => s.affordances.flatMap((a) => [a, ...(a.children ?? [])]));
  for (const bad of ['Publisher', 'United States', 'Country']) expect(all.some((a) => a.label === bad), bad).toBe(false);
  expect(all.some((a) => /^\d{2} \w{3} \d{4}$/.test(a.label))).toBe(false);  // no date literals
  const shell = g.states.find((s) => s.label === '_shell')!;
  expect(shell.affordances.length).toBeGreaterThanOrEqual(8);            // sidebar+topbar
  const report = g.states.find((s) => s.label === 'report')!;
  expect(report.affordances.filter((a) => !a.scope).length).toBeLessThanOrEqual(30);
  expect(g.states.every((s) => !s.fingerprint.join().includes('Demo User'))).toBe(true);
  expect(g.receipt.requests.length).toBeGreaterThan(0);                  // 1-landing pages reported
});
```

- [ ] **Step 1:** Write + run: `npx vitest run tests/acceptance/the analytics SPA-local.test.ts` → investigate every failure as a REAL finding (fix in the producing task's code, never relax an assertion without recording why in the commit body).
- [ ] **Step 2:** Full `npm test` + `npx tsc --noEmit` green.
- [ ] **Step 3:** Rebuild the live map: `webnav dev node-clear --node app.example.com` then `webnav dev graph-analyse --host app.example.com --draft` piped through the documented edit flow; `webnav dev graph-show --node app.example.com` → eyeball states/affordances/shell. Restart `dev dashboard`, screenshot Sites tab (light AND dark), verify shell card + provisional badges render.
- [ ] **Step 4:** Commit: `test(acceptance): the analytics SPA 5-session rebuild pins the clean-map bar`

---

### Task 16: live cross-site validation + merge (orchestrator: Fable; webnav-driving agents: haiku)

Needs network + playwright-cli; headless only; ONE session at a time; `webnav dev sessions reap` after each.

- [ ] **Step 1 — saucedemo (regression):** `webnav dev graph-show --node www.saucedemo.com` for exact labels, then `webnav walk --start <login-state> --goal <checkout-complete-state> --headless` → expect `status: done` (resume protocol allowed). This proves the seeded map + walk still work end-to-end.
- [ ] **Step 2 — OrangeHRM (the redirect-mismatch site, fresh):** haiku agent drives `webnav use session` (headless, opensource-demo.orangehrmlive.com, public demo creds Admin/admin123): login → visit 4 sidebar modules → revisit 2 of them (second landings!) → stop. Then `graph-analyse --host opensource-demo.orangehrmlive.com --draft --skip-review-gate` (engineering validation — note the skip in STATUS). Assert: sidebar modules interlinked via `_shell` (the old hub-and-spoke gap closed), no `-2` labels, revisited pages non-provisional, single-visit pages provisional.
- [ ] **Step 3 — automationexercise (4th archetype, e-commerce):** haiku agent records: home → products → 2 DIFFERENT product detail pages (instance variance!) → cart. Assert: the two product pages merged into ONE `/product_details/{param}` state whose fingerprint contains no product name.
- [ ] **Step 4 — the analytics SPA confirm-visits:** if the `default` profile still holds the Cloudflare session: record a short session opening a SECOND report + SECOND dashboard (the `requests` the map asks for) → rebuild → previously-provisional states confirm and instance headings leave the cores. If auth expired: STOP and ask the user to re-login (gated).
- [ ] **Step 5:** Update `docs/STATUS.md` (new snapshot: structure-inference shipped, validation results per site) + CLAUDE.md Status pointer line. `npm test` green.
- [ ] **Step 6:** Merge `structure-inference` → `main` (superpowers:finishing-a-development-branch), reap all browser sessions.

---

## Self-review notes

- **Spec coverage:** settledness→T6; declaration→T3/T9; cross-page shell→T4/T8; cross-visit core+provisional→T4/T7/T10; repetition→T5/T9; joint identity propose/dispose + SPA split→T2/T7; aliases→T6/T7/T8; refuses-to-store→T9/T10; schema deltas→T11; analyse requests→T10/T12; viewer→T13; deleted-heuristics list→T7/T9/T10 + guard T1; acceptance 1-5→T15/T16 + guard; review audit→T14. No spec item uncovered.
- **Deliberate scope cuts (recorded):** aliases stay draft-internal (no store table — nothing consumes stored aliases yet; add when `locate` needs them). Do-not-click policy fields on `_shell`: future. `dev confirm` auto-revisit verb: future (noted in STATUS).
- **Type consistency check:** `Face`/`UrlModel`/`TemplateGroup`/`CoreResult`/`FoldedRepeat` defined T2-T5, consumed T7-T10 with matching names; `scope: 'row'` spans DraftAffordance (T9) → Affordance/EditAffordanceObj (T11); `provisional` spans DraftState (T7) → State/EditState (T11); `requests` on `receipt` (T7 produces field, T10 fills, T12 documents).
