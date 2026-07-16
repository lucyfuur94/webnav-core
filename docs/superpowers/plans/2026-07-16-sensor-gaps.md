# Sensor Gaps (X6 + X2 + structure audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the two open capture blind spots (unnamed icon controls on landings; hover-/right-click-only affordances) and make remaining blind spots measurable per session.

**Architecture:** A capped, serialized name-probe enriches landing snapshots with OBSERVED names carried as an effect-level `nameHints` sidecar (new column) and applied at draft's single landing-parse seam. A new opt-in `dev hover-probe` verb reveals hover/context repertoires as ordinary reveal effects. The review prompt gains a per-landing named-vs-nameless structure summary.

**Tech Stack:** existing — TypeScript strict, better-sqlite3, vitest, playwright-cli via PlaywrightAdapter.

**Spec:** `docs/superpowers/specs/2026-07-16-sensor-gaps-design.md` (read it first; it carries the settled rules that bind every task).

## Global Constraints

- Zero LLM in webnav; hints and reveals are OBSERVED evidence only; never guess, never invent a name; commit points never fired (the probe never clicks inside a revealed menu).
- The map stores structure, never data values (tests/guidelines.test.ts must stay green).
- Probes are bounded: name-probe cap default 16 refs per landing, fires only when nameless interactive nodes exist; hover-probe `--limit` default 12 candidates, opt-in verb only — NEVER inline in the human tick loop.
- Uniform JSON stdout for verbs; 2-space indent; single quotes; comments only for constraints code can't show.
- Style/testing conventions identical to the repo's existing recorder/draft tests (fake adapters, synthetic effects; no real browser in unit tests).
- Commits: author dikshant.y, conventional messages, one per task.

---

### Task 1: Probe helper + adapter rightClick

**Files:**
- Create: `src/recorder/probe.ts`
- Modify: `src/playwright/adapter.ts` (one method)
- Test: `tests/recorder/probe.test.ts` (new), `tests/playwright/adapter.test.ts`

**Interfaces (later tasks consume exactly these):**
- `export const PROBE_ROLES: Set<string>` — `button, link, menuitem, tab, checkbox, radio, switch`
- `export function namelessInteractive(nodes: SnapNode[]): SnapNode[]` — nodes with a ref, role in PROBE_ROLES, and no non-empty name
- `export async function probeNames(adapter: { evalJs(js: string, ref?: string): Promise<string> }, nodes: SnapNode[], cap?: number): Promise<Record<string, string>>` — serialized `NAME_PROBE_JS` per nameless ref (max `cap`, default 16), each result through `parseEvalResult` + `enrichName(null, probed)`; only non-null names enter the map; an eval that throws is skipped (never aborts the batch)
- `PlaywrightAdapter.rightClick(ref: string)` → `this.exec('click', ref, 'right')`

**Steps:**
- [ ] Write failing tests: `namelessInteractive` picks only nameless+ref+role-listed nodes; `probeNames` with a fake `evalJs` returns hints for probed refs, respects the cap (assert call count), skips throws and error-blob results (`'### Error…'` → omitted); adapter test pins `['-s=…','click','e1','right']`.
- [ ] Run: `npx vitest run tests/recorder/probe.test.ts tests/playwright/adapter.test.ts` — FAIL.
- [ ] Implement `probe.ts` (import `NAME_PROBE_JS`, `enrichName` from `./agent-session.js`, `parseEvalResult` from `../router/browse.js`, `SnapNode` from `../playwright/snapshot.js`) and the adapter method.
- [ ] Tests PASS; full `npm test` once; commit `feat(recorder): landing name-probe helper + adapter rightClick`.

---

### Task 2: nameHints capture + storage + draft consumption (X6)

**Files:**
- Modify: `src/mapstore/record.ts` (ActionEffect.nameHints + `name_hints` column in `migrate()` + append/read round-trip)
- Modify: `src/router/browse.ts` (`recordNavigateEffect` probes the settled landing; populate `nameHints`)
- Modify: `src/recorder/agent-session.ts` (navigate branch: probe settled landing, populate `nameHints`)
- Modify: `src/explorer/draft.ts` (in `pushLanding` where `parseSnapshot(snap)` runs (~line 554): nameless node whose ref has a hint gets `name = hint` — ONE seam, before all downstream gates)
- Test: `tests/mapstore/record-action.test.ts`, `tests/router/browse-record.test.ts`, `tests/recorder/agent-session.test.ts`, `tests/grammar/collections.test.ts` (or a sibling grammar file)

**Interfaces:**
- Consumes: `probeNames`/`namelessInteractive` (Task 1).
- Produces: `ActionEffect.nameHints?: Record<string, string>` (effect-level — bare navigations have `action: null`); stored in new `name_hints TEXT` column (existing `migrate()` ALTER pattern), read back by `actionEffects()`.

**Steps:**
- [ ] Failing tests: (a) record round-trip: append effect with `nameHints: {e5:'Expand'}` → `actionEffects()[0].nameHints` equals it; absent stays undefined; old-db open still works (fromDatabase on a blank :memory: db). (b) `recordNavigateEffect` with a fake adapter whose snapshot holds a nameless button `[ref=e5]` and whose `evalJs` returns `'Expand'` → appended effect carries `nameHints.e5 === 'Expand'`; a fully-named landing triggers ZERO evals. (c) agent-session navigate branch: same via the scripted-stdin harness. (d) grammar: a landing whose snapshot has 3 nameless icon buttons + `nameHints` naming them → draft emits those affordances with the observed names; the SAME landing without hints keeps the existing honest-omission assertion (do not delete it).
- [ ] FAIL → implement (populate probes ONLY when `namelessInteractive(parsed).length > 0`; probe the SETTLED snapshot; agent-session passes its adapter through; the draft patch loops parsed nodes once before they enter `landingsByKey`).
- [ ] PASS → full `npm test` → commit `feat(capture): landing name-probe — observed names for icon-only controls (X6)`.

---

### Task 3: `dev hover-probe` verb (X2)

**Files:**
- Create: `src/recorder/hover-probe.ts` (pure candidate selection + the probe loop with injected deps)
- Modify: `src/cli.ts` (verb + arg parsing per the `dev verify --session` shape, cli.ts:217 template), `src/cli-spec.ts`/`src/cli-help.ts` (registry + help; grep how existing dev verbs register)
- Test: `tests/recorder/hover-probe.test.ts` (new), `tests/cli-spec.test.ts` if the registry pins verb lists

**Interfaces:**
- `export function hoverCandidates(nodes: SnapNode[], limit?: number): SnapNode[]` — pure: nodes with `aria-haspopup` (exploration: check how parseSnapshot exposes it; if it doesn't, use role `menuitem` + named interactive nodes inside `banner`/`navigation` landmark subtrees), deduped, capped (default 12).
- `export async function runHoverProbe(deps: { adapter: {snapshot(): Promise<string>; hover(r: string): Promise<unknown>; rightClick(r: string): Promise<unknown>; currentUrl(): Promise<string>}; store: {isActive(s: string): boolean; appendActionEffect(...): number | null; appendEvent(...): number | null; stampEvent(...): void}; sessionId: string; limit: number; rightClick: boolean; log: (l: string) => void }): Promise<{ probed: number; revealed: number }>` — per candidate: baseline snapshot → hover (or rightClick) → bounded settle (reuse `settleSnapshot`) → diff (`diffSnapshots`); non-empty ADDED diff → append `ActionEffect` with `action: { role, name, ref, hover: true }` (or `rightClick: true`) + ledger event `kind:'hover'|'right-click'`; neutralize between candidates (hover a body-level ref or press Escape via existing primitives — implementer picks the honest available mechanism and documents it).
- CLI: `webnav dev hover-probe --session <S> [--limit N] [--right-click]` → stdout `{status:'done'|'empty', session, probed, revealed}`; exit 3 when `revealed === 0`.
- Draft: verify `hover: true` same-page effects with added subtrees already flow through the reveal branch of `draftFromEffects`; extend whatever kind-marker logic exists to treat `rightClick: true` identically. Add/adjust a draft-level test.

**Steps:**
- [ ] Failing tests: candidates pure-function cases (haspopup, nav-landmark members, cap, dedupe); runHoverProbe with a scripted fake adapter (2 candidates, 1 reveals → one effect appended with hover:true + ledger row; nothing revealed → zero appends); right-click mode pins `rightClick: true`; draft test: synthetic rightClick effect with added subtree → reveal affordance (+ existing hover case still green).
- [ ] FAIL → implement → PASS → full suite → commit `feat(dev): hover-probe verb — reveal hover/context repertoires (X2)`.

---

### Task 4: Structure audit in `dev review`

**Files:**
- Modify: `src/recorder/coverage.ts` (add the summarizer beside `coverage()`), `src/recorder/review.ts` (prompt section + ReviewDeps field + review.json), `src/cli.ts` (`dev review` + the capture-loop review callback — BOTH call sites, the Task-6 lesson)
- Test: `tests/recorder/coverage.test.ts`, `tests/recorder/review.test.ts`

**Interfaces:**
- `export interface LandingStructure { url: string; named: number; nameless: number }`
- `export function landingStructure(effects: Pick<StoredActionEffect,'toUrl'|'toSnapshot'>[]): LandingStructure[]` — dedupe landings by URL path (same `didNavigate`-style normalization the repo already uses), count interactive nodes named vs nameless per landing (reuse `PROBE_ROLES`).
- `buildReviewPrompt` gains trailing `structure?: LandingStructure[]` → section `LANDING STRUCTURE (named vs NAMELESS interactive controls per page — many nameless controls = a sensor gap; compare against what the frames show)`. `ReviewDeps.structure?`; review.json gains `structure`.

**Steps:**
- [ ] Failing tests: summarizer (two landings same path dedupe; counts split named/nameless); prompt pin (`LANDING STRUCTURE`).
- [ ] FAIL → implement → thread through BOTH runSessionReview call sites → PASS → full suite → commit `feat(review): per-landing structure summary — nameless-control gaps measurable`.

---

### Task 5: Matrix bookkeeping + gap audit (docs only)

**Files:** `docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md`, `docs/STATUS.md`

**Steps:**
- [ ] Audit X4/X5/X7/X8/X9 against current main (git log since 07-12 + STATUS entries + the relevant code): mark each CLOSED (with commit) or OPEN (one-line reason) in the matrix's GAPS table.
- [ ] Flip X2/X6 rows to reflect this increment (X6: covered on the agent path, human tick path honestly deferred; X2: covered via the opt-in probe verb).
- [ ] STATUS.md top entry for the increment. Commit `docs: matrix verdicts after sensor-gap increment`.

---

### Task 6: Live E2E (headless, LOCAL fixtures, scratch WEBNAV_DB)

**Steps:**
- [ ] Build two tiny local fixture pages in the scratch dir (plain HTML, no deps): (a) icon-dashboard — 6 icon-only buttons with names ONLY in `title`/`data-tooltip` attrs; (b) hover-nav — a top nav whose flyout links appear on `:hover` (CSS) plus a custom `contextmenu`-listener menu. Serve with `python3 -m http.server` on a scratch port.
- [ ] `WEBNAV_DB=<scratch>/e2e.db` ALWAYS (the 07-16 lesson: dbPath() is ~/.webnav, never cwd). Headless agent session → navigate icon-dashboard → quit; `dev graph-analyse --draft` (or the draft path used by tests) shows the 6 controls NAMED. Evidence: command + output.
- [ ] Second session on hover-nav → `dev hover-probe --session <S>`; expect `revealed ≥ 1`; draft shows the flyout links as reveal children; `--right-click` reveals the context menu. Evidence: command + output.
- [ ] `dev review` output includes `structure` with the icon-dashboard landing at nameless:0 after the probe (named by hints).
- [ ] Reap every browser opened (close by name, then `dev sessions reap`); kill the http.server; nothing left in `dev sessions`.
- [ ] Full `npm test` + `npx tsc --noEmit` green. Report evidence per step.
