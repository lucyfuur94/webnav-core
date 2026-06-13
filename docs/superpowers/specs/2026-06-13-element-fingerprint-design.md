# Element fingerprint — durable, layered, authored-unique resolution (design)

**Date:** 2026-06-13 · **Status:** spec for review (not yet built) · **Supersedes** the
name-only `resolveStep` matching.

## Problem

`resolveStep` (src/router/resolve.ts) matches a walk step to a live element by **name
only**, returning a ref iff *exactly one* node carries that name — otherwise it returns
null and the walk escalates (`needs-navigation`). This conflates two very different
situations:

1. **Under-captured (a map gap, NOT real ambiguity).** OrangeHRM's login page has a
   `heading "Login"` AND a `button "Login"`. Two name-matches → escalate. But these are
   trivially distinguishable — one is a heading, one is a button. The walk shouldn't have
   to ask; the map just failed to record the element *type*.
2. **Genuinely ambiguous.** Five `button "+"`, each doing something different. Name +
   type are identical; only *context* (which section/row) or position tells them apart.

The settled "do not guess" principle (#5a) is correct for case 2 but WRONG for case 1 —
case 1 is a capture deficiency, not a fork. **The fix: capture enough durable, structured
signal in the map that case-1 collisions resolve deterministically, and make the map
carry a disambiguator so case-2 collisions never reach the walk as ambiguous either.**
Escalation becomes the rare true-exception, not the routine.

This is a deliberate rebalancing of the project's core trade-off:
**"do not guess" vs "self-heal on change."** We move the line: store MORE durable
identifying signal (so fewer things are guesses), while keeping the disposable
selector cache for the genuinely-churny bits.

## Evidence — which attributes to store (churn-scored)

From the mature automation ecosystem (Playwright locator hierarchy; self-healing tools
Healenium/Testim/mabl; React/Angular dynamic-attribute findings — see Sources). The
whole industry resolves elements by a **weighted multi-attribute fingerprint** ordered by
churn-resistance, preferring user-facing/accessibility attributes over structural ones.

| Layer | Attribute | Churn | Role in our map |
|---|---|---|---|
| 1 | **role** (button/link/heading/textbox; ARIA) | very low | PRIMARY key — purpose is durable |
| 1 | **accessible name** (aria-label / `<label>` / button text) | low | PRIMARY key — user-facing |
| 2 | **label · placeholder · alt · title** | low | secondary name sources (same family) |
| 2 | **data-testid** (when present) | low* | opportunistic exact key when the site provides it |
| 3 | **structural anchor** (nearest labeled ancestor/section + relative position) | medium | the DISAMBIGUATOR for identical siblings (the "+ buttons" case) |
| 3 | order/index ("the 3rd match") | med-high | last-resort tiebreaker only; `log()` when used |
| — | text content | medium | hint, not key (breaks on copy/i18n) |
| — | id / class | high | NOT a key — React/Angular auto-generate (`sc-hGFkgZ`); disposable hint only |
| — | xpath / css path | very high | the `selectorCache` that is MEANT to rot (self-heal) |

Design rule: **layers 1–3 are the durable map key; id/class/xpath are the only things
allowed in the disposable `selectorCache`.** We are not shying away from storing — we
store the *right* (low-churn) attributes and are disciplined about which may rot.

## Data model

Extend `Affordance` (src/mapstore/types.ts) with an optional **target fingerprint**.
Optional = back-compat: existing maps (saucedemo) with no fingerprint fall back to
today's name-only match.

```ts
export interface ElementFingerprint {
  role: string;                 // layer 1 — required when fingerprint present (e.g. 'button')
  name: string | null;          // layer 1 — accessible name (may differ from the step's prose)
  // layer 2 — opportunistic exact keys, any may be null
  testId?: string | null;
  placeholder?: string | null;
  // layer 3 — CONTENT anchor: disambiguates identical (role,name) siblings by a durable
  // DISTINGUISHING TEXT that lives in the same enclosing row/card as the target (e.g. the
  // employee-id "444444", the product "Sauce Labs Backpack"). null when layers 1–2 are
  // already unique (the common case). NOT positional — `near` keys on CONTENT, so it
  // survives reordering; we deliberately do NOT store an index (see §Anchoring, churn rule).
  near?: string | null;
}
// On Affordance AND on the projected Edge (both — see §Thread-through):
//   elementFp: ElementFingerprint | null;   // null => legacy name-only resolution
//   selectorCache stays as-is: the disposable id/class/xpath hint (self-heal)
```

**Field name is `elementFp`, NOT `fingerprint` (S7).** The codebase already has
`State.fingerprint: string[]` (state-IDENTITY tokens consumed by `matchState`) plus
`states.fingerprint` and `record_observations.fingerprint` DB columns — all a different,
load-bearing concept. Adding a third `fingerprint` of a different type on adjacent
types/tables is a trap. The new field/column is `elementFp` / `element_fp`; it never touches
the state-fingerprint path. (Throughout the rest of this spec, "the fingerprint" = `elementFp`.)

### Thread-through (resolution operates on Edge, not Affordance)

The walk/resolve path consumes **`Edge`**, and edges are *projected* from affordances by
`store.projectFromAffordances` — a field not explicitly copied there is dropped. So the
fingerprint must be carried end-to-end, or `resolveStep` receives nothing:
1. add `fingerprint` to the `Edge` interface (`types.ts`) + `makeEdge` defaults (null);
2. copy it in `projectFromAffordances` (`store.ts`) `makeEdge({...})` when projecting navigate/reveal affordances;
3. add a `fingerprint` column to the `edges` table (`schema.sql` + the idempotent migration in
   `store.ts`) — JSON-encoded, nullable. Stored rows win on dedup in `edgesFrom`, so an
   edge-row-authored step must carry it too;
4. **`upsertEdge` writes the column** (add to the INSERT/UPDATE column list + `@fp` bind,
   `JSON.stringify(e.fingerprint ?? null)`) **and `rowToEdge` parses it back**
   (`r.fingerprint ? JSON.parse(r.fingerprint) : null`) — the exact pair the prior B1 missed;
   a stored row that doesn't round-trip the column silently falls to legacy name-only;
5. change `resolveStep`/`replayStep` to take the `Edge` (or its fingerprint) and use it;
6. update the TWO direct `resolveStep` call sites in `walk.ts` (the classify-safe path and
   the ref-answer self-heal path);
7. **fingerprint-aware self-heal write-back.** When the agent picks an element at a fork, the
   heal must persist enough to resolve uniquely next time — `recordSelector` is extended to
   write the **full `{role, name, near}` of the chosen node into the edge row's
   `elementFp`** (the new field; see naming below), NOT a bare name into `selector_cache`.
   - role+name alone is NOT enough when the fork was reached via step 5 (the N-identical case):
     the heal MUST compute `near` for the chosen node using the SAME `resolveByNear` scope
     logic recording uses (the chosen node + its snapshot are in hand at the heal site —
     `walk.ts:132-133` holds `beforeNodes` + `chosen`), else the next walk re-collides at
     step 3, has no `near`, and re-escalates forever (S2/S4). If no distinguishing `near`
     exists in the chosen node's clean scope, the heal stores `{role,name}` and the step
     honestly remains a per-walk escalation (don't claim a heal that can't stick).
   - `recordSelector`'s signature changes from `(from,to,step,selector:string)` to
     `(from,to,step,fp: ElementFingerprint)`; it does `UPDATE edges SET element_fp=?`. The
     `walk.ts:142` call site passes the computed fp instead of `chosen.name`. `selector_cache`
     is RETAINED only for legacy name-only edges (the legacy resolver still reads it); new
     heals never write it.
   - (Unchanged limitation: a purely-projected edge with no stored row still can't persist a
     heal — `recordSelector` no-ops on no row; fingerprints make this rare since
     authored/recorded affordances carry the fp up front.)

`semanticStep` stays (durable prose, drives `--help`/viewer readability). The fingerprint
is the machine key; `semanticStep` no longer needs to encode the name in quotes once a
fingerprint exists (but keep it for legacy + human readability).

## Resolution algorithm (resolveStep rewrite)

Deterministic, zero-LLM, in strict order. Input: the fingerprint (or legacy name) + the
parsed snapshot nodes.

```
1. legacy path: no fingerprint → today's behavior (single name match else null). [back-compat]
2. testId present → match nodes by data-testid AND `role==fp.role` (and name if set); unique?
   return it. (A reassigned-but-unique testId must still match role/name, else fall to step 3
   — testId is a hint, not an override of the durable layer-1 key.)   [layer 2 exact]
3. candidates = nodes where role == fp.role AND name == fp.name.       [layer 1]
   - 1 match  → return it.                                             [OrangeHRM heading-vs-button solved here]
   - 0 match  → escalate (real drift; self-heal can repair).
   - >1 match → go to 4.
4. fp.near present → `resolveByNear` (below): for each candidate, find its LARGEST enclosing  [layer 3]
   scope that excludes every other candidate; keep candidates whose scope contains `near`.
   - exactly 1 → return it.   [the 50×2 icon-button table + 6 carts solved here — VERIFIED]
   - else → 5.
5. STILL not unique (no `near`, or `near` matched 0 / >1 rows) → TRUE ambiguity. Escalate
   `needs-navigation` naming it ("N 'button ' and no distinguishing text recorded —
   re-author with `near`"). The agent picks; webnav writes the choice back (self-heal).
   This is the only escalation-for-ambiguity path — and per §Authoring it should be rare,
   but it is a PERMANENT, first-class backstop (drift can add a duplicate after authoring,
   and hand-authored maps may be unverified), NOT a "can't happen".
```

`near` containment uses snapshot **indentation depth** (added to `SnapNode`). The rule is
**smallest-ancestor-that-CONTAINS-`near`**, NOT nearest-container — derived from and verified
against the committed real captures (`tests/fixtures/saucedemo-inventory.yml`,
`tests/fixtures/orangehrm-pim-table.yml`); see §Worked examples (verified) below. The earlier
"stop at the first container" rule was WRONG — it picks the target's immediate wrapper (the
saucedemo price-box, the OrangeHRM action-cell), whose subtree EXCLUDES the sibling carrying
`near`, so every candidate fails and the walk escalates on its own motivating case.

**The rule (verified against real bytes — see §Worked examples):** a candidate's anchor scope
is the **LARGEST enclosing ancestor whose bounded subtree still EXCLUDES every OTHER candidate**
(the per-card / per-row scope, found by climbing outward and stopping just before an ancestor
that would pull in a sibling candidate). `near` must appear in THAT scope. This is NOT
"nearest container" (too small — excludes the sibling holding `near`) and NOT "smallest
ancestor that contains `near`" (too big — a high ancestor contains every candidate's `near`,
so all match → escalate). It is the tightest *non-shared* scope.

`anchorRef(nodes, candIdx, otherCandIdxs) -> scope | null`:
```
scope = null
for each ancestor A of candIdx (preceding node, strictly-decreasing depth, nearest first):
    boundedSubtree(A) = A's following nodes until the first depth <= A.depth (next sibling/uncle)
    if boundedSubtree(A) contains ANY other candidate index → STOP, return scope (the previous, smaller one)
    scope = A          // still clean (no sibling candidate) → remember, try larger
return scope           // largest clean ancestor (null if none / flat page)
```
`resolveByNear(nodes, candidates, near)`:
```
hits = candidates where:
    scope = anchorRef(nodes, cand, candidates\{cand})
    scope != null AND boundedSubtree(scope) contains a node (≠ cand) whose name == near
exactly 1 hit → return it.  [the 6 carts + 50×2 icon buttons resolve here — VERIFIED below]
0 or >1 hits → step 5 (escalate). FLAT page (no clean ancestor) → 0 → escalate.
```
**Why it can't wrong-click:** the scope is bounded away from sibling candidates by construction
(it stops before any ancestor that would include another candidate), so card A's scope never
contains card B's `near`. And exactly-one-hit is required: a `near` generic enough to sit in
two candidates' scopes → >1 → escalate, never a guess. No container-role allow-list is needed —
the cross-candidate exclusion does all the bounding, so it works whether the card/row is a
`generic`, `row`, `listitem`, or unlabeled. Pure structural, no LLM.

## Authoring guarantees uniqueness (the chosen rule)

Decision (2026-06-13, with user): **true ambiguity is prevented at authoring/record
time, not escalated at walk time.** Concretely:

- **Recording** (`use click` while a session records): when the agent clicks an element,
  capture its FULL fingerprint from the live snapshot — role, accessible name, testId,
  AND, if >1 element shares that (role,name) on the page, automatically compute `near` — a
  distinguishing TEXT in the clicked element's bounded row/card (e.g. the row's id cell, the
  card's product name). NEVER an index/position (per the data model). If no distinguishing
  text exists in range, recording flags the step as not-uniquely-resolvable rather than
  storing a positional guess. So a recorded step is unique-by-construction (or honestly flagged).
- **`graph-edit`** (hand authoring): accept a `fingerprint` object on an affordance.
  VALIDATE at write time against… nothing live (graph-edit is offline) — so instead
  `graph-edit` requires `role`+`name` minimum, and `dev outline`/a new `dev verify`
  check flags any state whose stored fingerprint is not unique against a provided live
  snapshot. (Authoring uniqueness is enforced where a live page is available: recording,
  or a `dev verify --session` pass.)
- **Walk** therefore assumes the map is unique and resolves deterministically; step 5
  above is the safety net that turns a residual ambiguity into a loud "re-author"
  message, not a silent wrong click.

## Worked examples — traced against committed real captures (2026-06-13)

These are the GROUND TRUTH the algorithm was derived from and must pass. Both are committed
as test fixtures (`tests/fixtures/`), captured live from the real sites this session. The
indents are the actual leading-space counts in the captures.

### saucedemo inventory (`tests/fixtures/saucedemo-inventory.yml`) — 6× `button "Add to cart"`
```
 6  generic e43                         ← the CARD (smallest scope holding both name & button)
 8    link "Sauce Labs Backpack" e45    (image link)
 8    generic e47
10      generic e48
12        link "Sauce Labs Backpack" e49
14          generic "Sauce Labs Backpack" e50   ← a node matching near
12        generic "carry.allTheThings()…" e51
10      generic e52                     ← the price-box (the button's nearest wrapper)
12        generic "$29.99" e53
12        button "Add to cart" e54      ← TARGET
```
Trace for `fingerprint{role:'button', name:'Add to cart', near:'Sauce Labs Backpack'}`
(VERIFIED by running the algorithm over the fixture — resolves e54; Bike Light→e66; Fleece→e90):
- step 3: 6 nodes match role+name → >1 → step 4.
- `anchorRef(e54)`: climb e52(d10)→clean→ e47(d8)→clean→ e43(d6, the card)→clean→ e42(d4, the
  product GRID)→ its subtree contains the OTHER 5 Add-to-cart buttons → STOP, return the
  previous clean scope = **card e43 (d6)**.
- card e43's bounded subtree holds `link "Sauce Labs Backpack" e49` (≠ target) → hit.
- Each other button's clean scope is its own card holding its own product name → exactly 1
  candidate hits for `near:"Sauce Labs Backpack"` → **resolves e54.** ✅

### OrangeHRM PIM table (`tests/fixtures/orangehrm-pim-table.yml`) — 50× edit + 50× delete icon buttons
The icon buttons are named by Font-Awesome **glyph codepoints** (edit = ``, delete =
``) — so 50 edit buttons share one (role,name) and 50 delete buttons share another;
role+name alone is useless, `near` does the work.
```
12  row " dfgsjsjdh 123445 34 444444 " e268   ← the ROW (50 rows are siblings under the table)
14    cell "dfgsjsjdh" e276                    ← employee name (another usable `near`)
14    cell "444444" e280
16      generic "444444" e281                  ← node matching near:"444444"
14    cell " " e286
18      button "" e288                    ← TARGET edit
18      button "" e290                    ← delete (distinct action, same row)
```
Trace for `fingerprint{role:'button', name:''(edit), near:'444444'}`
(VERIFIED running the algorithm: edit→e288, delete `name:''`→e290 — **distinct refs in
the same row**, out of 50 candidates each; `near:'dfgsjsjdh'` also → e288):
- step 3: 50 `button ""` match → >1 → step 4.
- `anchorRef(e288)`: climb its cell/generic ancestors → up to `row e268` (d12) → clean (the row
  holds only this row's edit button among edit-candidates) → the table body that holds the
  other 49 edit buttons → STOP, return **row e268**.
- row e268's subtree holds `e281 "444444"` (≠ target) → hit. Each row holds its own id →
  exactly 1 → **resolves the edit button in employee 444444's row.** ✅ Reordering rows moves
  the id WITH its row, so `near` stays correct → durable.

### GitHub repo page (the flattened capture from the prior review)
Fully flat (all nodes depth 0) — BUT every link is already distinct by name, so resolution
returns at step 3 and never reaches layer 3. Flattening only co-occurred with *not needing*
anchoring; it is not a counterexample.

Honest limit: a page that is BOTH flat AND has identical role+name siblings with no
distinguishing text in any enclosing scope → step 5 (escalate). Correct: genuine ambiguity →
agent picks → self-heal writes `{role,name,near}` back. We anchor on CONTENT, never position,
so a stored `near` survives reordering.

## Snapshot parser change (src/playwright/snapshot.ts)

`SnapNode` gains `depth: number` (indent level — currently `parseSnapshot` does `line.trim()`
and discards it; capture the leading-space count BEFORE trimming, mirroring the prototype in
`docs/superpowers/artifacts/fingerprint-algo-prototype.mjs` which is the reference impl). The
helpers are `ancestorsOf(nodes, idx)` (preceding nodes, strictly-decreasing depth) +
`anchorScope(nodes, candIdx, otherCandSet)` (largest clean ancestor) + the `resolveByNear`
loop — NO container-role allow-list (the cross-candidate exclusion does the bounding; verified
against the real fixtures regardless of whether the card is `generic`/`row`/`listitem`).
Also surface `testId`/`placeholder` if playwright-cli emits them in the snapshot line
(investigate; if absent those layers degrade to unavailable and we rely on role+name+`near` —
which the committed-fixture proof shows fixes both motivating cases).

## graph-edit / edit.ts

`EditAffordanceObj` gains optional `elementFp`. The existing gates-author-needs logic
(2026-06-13 fix) is unaffected. `toAffordance` passes `elementFp` through. (S6 — dedup
shadowing: an edge-row authored directly via `EditEdge` has no `elementFp` field, so a stored
row could shadow a fingerprinted projected affordance on key collision. In practice gates are
authored onto the AFFORDANCE (per the 2026-06-13 gate fix, `findNavTarget`), not as a bare row,
so the projected affordance — which carries `elementFp` — wins. Documented stance: edge-only/
needsInput rows fall to legacy name-only resolution; if a future need arises, add `elementFp`
to `EditEdge` and carry it in `upsertEdge`. Not built now.)

## Input affordances + the credential-fill path (SF4)

`walk-live.ts` resolves login/checkout fields via `findByRoleAndName(nodes,'textbox','Username'|
'Password'|'First Name'|…)` — a HARDCODED role+name lookup that is already a de-facto two-layer
fingerprint living in a separate code path from `resolveStep`. Decision: the fingerprint applies
to `input` affordances too, and the credential/shipping fill resolves each field by the input
affordance's `fingerprint` (role+name, e.g. `{role:'textbox',name:'Username'}`) instead of the
hardcoded string — unifying the two resolution paths on one mechanism. This also covers OrangeHRM's
own Username/Password fields (exercised by the login→dashboard e2e). Back-compat: when an input
affordance has no fingerprint, fall back to the current hardcoded names so saucedemo/the existing
fixtures are unchanged.

**NOTE — there are TWO credential-fill closures** in walk-live.ts: `makeLiveWalkBrowser` (the one
the CLI uses) and a near-duplicate `fieldRef`/`act` inline in `runWalkLive`. BOTH must migrate to
the fingerprint mechanism, or one path stays on hardcoded names — a latent split. Prefer collapsing
to the single `makeLiveWalkBrowser` (the inline one looks redundant) while doing this. Saucedemo
login stays byte-identical via the no-fingerprint fallback regardless.

## `dev verify --session` (S8) — the live uniqueness backstop for hand-authored maps

graph-edit is offline so it can't check live uniqueness; `dev verify` is the only place a
hand-authored `elementFp` is checked against a real page. Spec it as a normal verb (uniform
JSON stdout + cli-spec registration + MCP-generated, per CLAUDE.md CLI rules):
- **Input:** `--node <id>` (the site) + `--session <S>` (a live browser already driven to the
  states, OR drive-to-each-state via the map's edges from the entry — v1: verify whatever state
  the session's browser is currently on; full drive-through is a follow-up).
- **Output (stdout):** `{ status, node, states: [{ id, affordances: [{ id, unique: bool,
  collidesWith: [refs] }] }] }`. `unique:false` lists the other live nodes the `elementFp`
  matched.
- **Exit codes:** 0 = all unique · 3 = some affordance non-unique (ran fine, found collisions)
  · 2 = error (no session / unknown node).

## Migration

- Additive: `states.affordances` is already a JSON blob → absent `elementFp` => null => legacy
  path; the `edges.element_fp` column is added via the existing idempotent migrate() (nullable).
- saucedemo keeps working unchanged (name-only fallback; its affordances have no `elementFp`).
- OrangeHRM: author login affordance with `elementFp:{role:'button',name:'Login'}` → resolves
  uniquely (heading excluded) → login works; PIM-table buttons get `elementFp` with `near` →
  rows resolve (proven by the prototype against the committed fixture).

## Testing

- **resolve (the proof):** a vitest test READS the two committed fixtures
  (`tests/fixtures/saucedemo-inventory.yml`, `orangehrm-pim-table.yml`) and asserts the exact
  refs the prototype proved: SD Backpack→e54, Bike Light→e66, Fleece→e90; OH edit-row-444444→
  e288, delete→e290. This ports `docs/superpowers/artifacts/fingerprint-algo-prototype.mjs`
  into the real `resolveStep` and locks the algorithm to real bytes (no hand-drawn fixtures).
- resolveStep units: legacy name-only unchanged; role+name disambiguates heading-vs-button;
  testId requires role match (S1); 0-match → escalate; residual >1 → escalate. NO index test.
- snapshot: `depth` parse; `anchorScope`/`resolveByNear` over the nested fixtures AND a
  flattened fixture (asserts 0 hits → escalate, never a wrong match).
- self-heal: `recordSelector` writes `{role,name,near}` to `element_fp`; a re-resolve after a
  step-5 heal resolves WITHOUT re-escalating (S2/S4 regression test).
- edit.ts: `elementFp` round-trips through graph-edit.
- walk-live: credential fill resolves fields by input-affordance `elementFp`; falls back to
  hardcoded names when absent (saucedemo login byte-identical).
- Live e2e (gated): OrangeHRM login→dashboard→PIM walk completes; saucedemo walk still completes.

## Phasing (implementation order, once spec approved)

1. snapshot `depth` + `ancestorsOf`/`anchorScope`/`resolveByNear` (+ tests reading the committed
   fixtures — the ported prototype proof; + a flattened fixture for safe degradation).
2. `ElementFingerprint` type (field `elementFp`) + Edge thread-through (types/makeEdge/projection/
   `edges.element_fp` column + `upsertEdge` write + `rowToEdge` parse + dedup) + `resolveStep`
   rewrite with legacy fallback + fingerprint-aware `recordSelector` (full `{role,name,near}`,
   computes `near` at heal) (+ tests) — fixes OrangeHRM heading-vs-button.
3. graph-edit `elementFp` authoring + BOTH walk-live credential closures on `elementFp` (+ tests);
   author OrangeHRM (login + PIM buttons) + verify the walk live end-to-end.
4. recording auto-captures `elementFp` — extend the `use click` verb / `ActionRef` to recover
   role+name (+`near` via `resolveByNear`) from `fromSnapshot` by ref-lookup (today cli.ts passes
   `{role:'',name:null}` — B4), thread through `ActionEffect`→`analyseActionEffects`→graph-edit
   payload (+ tests).
5. `dev verify --session` (spec above) + cli-spec registration; docs (CLAUDE.md principle #3
   amended: "store a durable element fingerprint (role+name+content-anchor `near`); cache
   disposable selectors; escalation stays the permanent backstop for true ambiguity").

## Out of scope

- ML/learned weighting of attributes (hosted-service territory; here it's a fixed,
  documented priority order).
- Visual/screenshot matching.
- Shadow-DOM piercing (note it; playwright-cli's snapshot already flattens most of it).

## Sources

- Playwright locators (priority: role > label > text > placeholder > alt > title >
  testId ≫ css/xpath; css/xpath "break when the DOM structure changes"):
  https://playwright.dev/docs/locators
- Self-healing weighted-fingerprint scoring (tag/id/class/text/role/position, confidence
  by reliability; "12 attributes can lose 8 and still match"): Tricentis, Healenium,
  Functionize write-ups.
- Dynamic id/class churn in React/Angular/Vue ("Selector Hell"; prefer data-testid /
  aria-label): alphabin.co, medium/@automationTest.
