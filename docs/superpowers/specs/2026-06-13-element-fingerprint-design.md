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
| 3 | **content anchor `near`** (a distinguishing TEXT in the target's enclosing row/card — an id, product name) | low–medium | the DISAMBIGUATOR for identical (role,name) siblings (the "+ buttons" / table-row case); keyed on CONTENT, survives reordering |
| — | order/index ("the 3rd match") | high | **NOT stored** — positional, breaks on reorder; `near` is content-based by design (§Anchoring) |
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
1. add `elementFp` to the `Edge` interface (`types.ts`) + `makeEdge` defaults (null) — the
   field is `elementFp`, NEVER `fingerprint` (S7: collides with `State.fingerprint`);
2. copy `elementFp` in `projectFromAffordances` (`store.ts`) `makeEdge({...})` when projecting
   navigate/reveal affordances — **NORMALIZE: `elementFp: a.elementFp ?? null` (D4).** A legacy
   affordance blob has no `elementFp` key → parses to `undefined`; `makeEdge`'s `{elementFp:null,
   ...init}` spread lets that `undefined` OVERWRITE the null default → the projected Edge carries
   `undefined`. So the legacy gate MUST be falsiness-based (`if (!fp)`, NOT `=== null`), and the
   parsed value's type is `ElementFingerprint | null | undefined` (consumers treat undefined as
   null). This is the exact path both motivating maps use (no edge rows). Add a test projecting a
   key-predating blob;
3. add an `element_fp` column to the `edges` table (`schema.sql` + the idempotent migration in
   `store.ts`) — JSON-encoded, nullable. Stored rows win on dedup in `edgesFrom`, so an
   edge-row-authored step must carry it too;
4. **`upsertEdge` writes the column** (add `element_fp` to the INSERT/UPDATE column list +
   `@elementFp` bind, `JSON.stringify(e.elementFp ?? null)`) **and `rowToEdge` parses it back**
   (`r.element_fp ? JSON.parse(r.element_fp) : null`) — the exact pair the prior B1 missed;
   a stored row that doesn't round-trip the column silently falls to legacy name-only;
5. change `resolveStep`/`replayStep` to take the `Edge` (or its `elementFp`) and use it;
6. update **all** `resolveStep` reachers in `walk.ts`: the two DIRECT calls (`walk.ts:108`
   classify-safe, `walk.ts:132`-area ref-answer) AND the indirect path via `replayStep`
   (`walk.ts:171`); plus the walk-live `fieldRef` input path (SF4);
7. **fingerprint-aware self-heal write-back — writes to `states.affordances`, NOT the edges
   table (B1 fix).** When the agent picks an element at a fork, the heal must persist
   `{role,name,near}` so the next walk resolves uniquely. CRITICAL: the fp `resolveStep`
   consumes is PROJECTED from the affordance blob (`projectFromAffordances`), and BOTH
   motivating maps have **no edge rows** — saucedemo seeds affordances only; the 2026-06-13
   gate fix authors gates onto the affordance and `continue`s past `upsertEdge`. So an
   `UPDATE edges` heal no-ops on the common case. Therefore:
   - New store method `recordElementFp(fromState, affordanceId, fp)` that sets the named
     affordance's `elementFp` (recursing reveal `children`) and re-`upsertState`s. **D5 — key by
     AFFORDANCE ID, not `(toState, semanticStep)`:** the affordance JSON blob has no uniqueness
     constraint (unlike the edges table's `UNIQUE(from,to,step)`), and the fingerprint feature's
     own target case is two navigate affordances in one state to the SAME `toState` distinguished
     only by `elementFp.near` — so `(toState, semanticStep)` is NOT a unique key there. Thread the
     affordance id through to the heal: reuse `interiorEdges`' existing `viaAffordance` identity
     (add `viaAffordance` to the projected `Edge` so `walk.ts` knows which affordance it traversed).
     The legacy fallback (`UPDATE edges SET element_fp`) applies ONLY to a legacy/explorer stored
     row with no backing affordance.
   - The heal computes `near` via the shared **`deriveNear`** on the chosen node + its live
     snapshot. The heal site is the resume `ans.kind==='ref'` branch (`walk.ts:142`, which holds
     `beforeNodes` + `chosen`); the FIRST-pass escalate (`walk.ts:180`) never heals. The heal
     adapter: `candIdx = beforeNodes.findIndex(n => n.ref === ans.ref)`; role+name come FROM
     `beforeNodes[candIdx]` (the chosen LIVE node), NOT from `edge.semanticStep`'s quoted prose
     (D7b — they can differ, line 63). If `deriveNear` returns null OR the chosen node has a null
     name, store nothing — the step honestly stays a per-walk escalation (D1).
   - **Two heal branches, made explicit (D6 — resolves the prior L116/L127 contradiction):**
     (a) the edge has a backing affordance (the common case, both motivating maps) → write
     `elementFp` onto the AFFORDANCE via `recordElementFp`; do NOT touch `selector_cache`.
     (b) a legacy/explorer STORED edge row with no backing affordance → write `selector_cache`
     EXACTLY as today (the legacy name-only resolver reads it at replay.ts:20). These are
     mutually exclusive per edge; `recordSelector` keeps a path for (b).
   - **S1/D6 test fallout (Phase 2):** update the `IMapStore` interface decl (store.ts:25) + the
     `walk.ts` call site. The NEW affordance-heal test uses a no-edge-row fixture (branch a). KEEP
     the existing legacy stored-edge heal test (walk.test.ts:136-180: `upsertEdge` → escalate →
     ref → assert `selectorCache` on the row → second walk resolves) UNCHANGED — it is the only
     regression cover for branch (b) (depended on by explorer.ts + replay.ts:20, principle #3).
     Do NOT repurpose it; add the affordance test alongside.

`semanticStep` stays. The `elementFp` is the machine key; `semanticStep` no longer needs to
encode the name in quotes once a fingerprint exists. **S6 — it MUST stay self-sufficient prose**
not because of viewer/`--help` nicety, but because it is the **agent-facing payload in every
`needs-*` response** (`walk.ts` builds each escalation `question` from `edge.semanticStep`;
`protocol.ts`): when webnav escalates, the agent reads `semanticStep` to decide. So it is part
of the #5 "surface evidence, agent judges" channel — trimming it to a bare verb would blind the
agent at exactly the fork. It is ALSO part of the edge identity key (`edgeKey`, the UNIQUE
constraint, the `recordSelector`/heal WHERE clause) → must stay STABLE; never rewrite it on an
existing edge. The step-5 escalation message MUST thread `semanticStep` (not a generic string).

## Resolution algorithm (resolveStep rewrite)

Deterministic, zero-LLM, in strict order. Input: the fingerprint (or legacy name) + the
parsed snapshot nodes.

```
1. legacy path: no fingerprint → today's behavior (single name match else null). [back-compat]
2. testId present → match nodes by data-testid AND `role==fp.role` (and name if set); unique?
   return it. (HARD INVARIANT, not an optimization: testId never overrides role+name — a
   reassigned-but-unique testId must still match them, else fall to step 3.)   [layer 2 exact]
   **S2 — v1 SCOPE:** playwright-cli's a11y snapshot emits no data-testid/placeholder tokens
   (verified: zero across all 5 fixtures; only `[ref=]`/`[cursor=]`/`[level=]`). So `SnapNode`
   carries no testId in v1 and step 2 is INERT — ship the proven role+name+`near` core; add a
   guard test that step 2 is skipped when testId is absent. Wire testId only if/when the
   snapshot format carries it (then the role-match invariant above applies).
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

`near` containment uses snapshot **indentation depth** (added to `SnapNode`), derived from and
verified against the committed real captures (`tests/fixtures/saucedemo-inventory.yml`,
`tests/fixtures/orangehrm-pim-table.yml`) by the runnable proof in
`docs/superpowers/artifacts/fingerprint-algo-prototype.mjs`; see §Worked examples below. Two
earlier rules were WRONG and are recorded so they're not re-attempted: "nearest container, stop
at first" (too small — picks the target's price-box/action-cell, excluding the sibling holding
`near` → all candidates fail → escalate on the motivating case), and "smallest ancestor that
contains `near`" (too big — a high ancestor contains every candidate's `near` → all match →
escalate). The correct rule is below.

**The rule (verified against real bytes — see §Worked examples):** a candidate's anchor scope
is the **LARGEST enclosing ancestor whose bounded subtree still EXCLUDES every OTHER candidate**
(the per-card / per-row scope, found by climbing outward and stopping just before an ancestor
that would pull in a sibling candidate). `near` must appear in THAT scope. This is NOT
"nearest container" (too small — excludes the sibling holding `near`) and NOT "smallest
ancestor that contains `near`" (too big — a high ancestor contains every candidate's `near`,
so all match → escalate). It is the tightest *non-shared* scope.

`anchorScope(nodes, candIdx, otherCandIdxs) -> scope | null`:
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
    scope = anchorScope(nodes, cand, candidates\{cand})
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

## `deriveNear` — WHICH text to store (B2/B3 keystone; the matcher's twin)

`resolveByNear`/`anchorScope` are MATCHERS — given a `near` string they find hits; they cannot
PRODUCE the string. Both record-time auto-capture AND step-5 heal need to choose WHICH in-scope
text to store. This is one shared function so the two sides cannot diverge (proven in the
prototype):
```
deriveNear(nodes, candIdx, role, name) -> string | null
  cands = nodes matching (role, name) with a ref
  scope = anchorScope(nodes, candIdx, {other cands})         // candidate's clean per-row/card scope
  if cands.length <= 1: return null                           // unique by role+name → no near needed
  if !scope: return null
  qualifying = [ T : text-bearing name in scope (excl candIdx, skip empty/whitespace)
                     where resolveByNear(nodes, cands, T) == [candIdx] ]  // T uniquely identifies candIdx
  if qualifying is empty: return null                         // honest flag: truly-identical sibling → escalate
  return the MOST STABLE T (nearStability desc; doc-order tiebreak)        // D3 — see below
```
`nearStability(text)` (pure, deterministic, no LLM): `+3` if id-like (`\d{3,}` run — id/SKU/order
no.), `+0..1` for length (more specific = less transient), `-2` if free-text prose (has a space AND
no digit — names/sentences). Among equally-correct (exactly-one-hit) anchors this prefers the
DURABLE one, honoring #3 ("store what doesn't change") at zero cost to the never-guess invariant.
**Verified against the committed fixtures** (prototype, all 12 cases PASS): SD e54→"Sauce Labs
Backpack", e66→"Sauce Labs Bike Light", e90→"Sauce Labs Fleece Jacket"; OH edit-e288 & delete-e290
→ **"123445 34"** (the id-like value, chosen OVER the free-text first-name "dfgsjsjdh" by
`nearStability` — D3), each round-trips back to its own ref. **S3 honest limit, proven**: 12/50 PIM
edit buttons sit in content-identical rows → `deriveNear` returns null → correctly unresolvable
(escalate), never wrong-resolved.

Recording MAY also let the agent-in-the-loop override the auto-picked `near` (it already has the
page open), and SHOULD echo the auto-derived `near` in the `use click` JSON so the write is
surfaced evidence, not silent.

**D1 — null-name semantics (matching + heal).** A `null` accessible name (icon-only glyphless
node) matches ONLY null-named nodes and is NOT a usable layer-1 key on its own: when
`elementFp.name === null`, resolution REQUIRES a `near` (or testId) — a bare `{role, name:null}`
selects every null-named node (e.g. 54 generics on the saucedemo page) and `deriveNear` over that
set is meaningless. Heal guard (replaces walk.ts:142's `if (chosen?.name)`): only persist an
`elementFp` when the chosen node has a non-null name OR `deriveNear` produced a non-null `near`;
otherwise store nothing and let the step stay a per-walk escalation (a heal of a truly
unidentifiable null-named element can never stick — don't pretend it can). Add a `resolveStep`
unit for `name === null`.

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
12        link "Sauce Labs Backpack" e49      ← THE near anchor (quoted accessible name)
14          generic e50 :Sauce Labs Backpack  ← post-colon TEXT → parses to name=null (NOT a near)
12        generic e51 :carry.allTheThings()…  ← post-colon text → name=null
10      generic e52                     ← the price-box (the button's nearest wrapper)
12        generic "$29.99" e53
12        button "Add to cart" e54      ← TARGET
```
Trace for `fingerprint{role:'button', name:'Add to cart', near:'Sauce Labs Backpack'}`
(VERIFIED by running the algorithm over the fixture — resolves e54; Bike Light→e66; Fleece→e90):
- step 3: 6 nodes match role+name → >1 → step 4.
- `anchorScope(e54)`: climb e52(d10)→clean→ e47(d8)→clean→ e43(d6, the card)→clean→ e42(d4, the
  product GRID)→ its subtree contains the OTHER 5 Add-to-cart buttons → STOP, return the
  previous clean scope = **card e43 (d6)**.
- card e43's bounded subtree holds `link "Sauce Labs Backpack" e49` (≠ target) → hit.
- Each other button's clean scope is its own card holding its own product name → exactly 1
  candidate hits for `near:"Sauce Labs Backpack"` → **resolves e54.** ✅

**D2 — eligibility constraint (matters for authoring + `deriveNear`):** only nodes with a parsed
QUOTED accessible name are eligible as `near`. The parser (`NODE_RE`) captures the quoted name
*before* the brackets; **post-colon text content** (`generic [ref=e50]: Sauce Labs Backpack`, a
price `…: $29.99`, an id `…: "444444"`) parses to `name=null` and is INVISIBLE to the matcher
(`resolve(…, '$29.99')` → escalate-0). So `near` must be a quoted-name node (here `link e49`, and
in the table `cell "444444" e280`), not the post-colon text node. (Optional future widening:
capture post-colon text in the parser to grow anchor availability + shrink the 12/50 null-derive
rate — out of scope for v1.)

### OrangeHRM PIM table (`tests/fixtures/orangehrm-pim-table.yml`) — 50× edit + 50× delete icon buttons
The icon buttons are named by Font-Awesome **glyph codepoints** (edit = ``, delete =
``) — so 50 edit buttons share one (role,name) and 50 delete buttons share another;
role+name alone is useless, `near` does the work.
```
12  row " dfgsjsjdh 123445 34 444444 " e268   ← the ROW (50 rows are siblings under the table)
14    cell "dfgsjsjdh" e276                    ← employee name (another usable `near`)
14    cell "444444" e280                       ← THE near anchor (quoted name on the cell; D2)
16      generic e281 :444444                   ← post-colon text → name=null (NOT the anchor)
14    cell " " e286
18      button "" e288                    ← TARGET edit
18      button "" e290                    ← delete (distinct action, same row)
```
Trace for `elementFp{role:'button', name:<edit glyph>, near:<derived>}`
(VERIFIED: `deriveNear(e288)`→**"123445 34"** (the id-like value, chosen over the free-text
first-name "dfgsjsjdh" by `nearStability` — D3) round-trips back to e288; delete→e290 likewise;
both ALSO resolve via `near:'444444'` — **distinct refs in the same row**, of 50 candidates
each. S3: 12/50 rows are content-identical → `deriveNear`→null → those correctly escalate):
- step 3: 50 edit-glyph buttons match role+name → >1 → step 4.
- `anchorScope(e288)`: climb its cell/generic ancestors → up to `row e268` (d12) → clean (the row
  holds only this row's edit button among edit-candidates) → the table body that holds the
  other 49 edit buttons → STOP, return **row e268**.
- row e268's subtree holds `cell "123445 34" e278` (and `cell "444444" e280` — both QUOTED-name
  nodes, ≠ target; NOT the post-colon `generic e281`, which parses to name=null per D2) → hit.
  Each row holds its own ids → exactly 1 → **resolves the edit button in that employee's row.** ✅
  Reordering rows moves the ids WITH the row, so `near` stays correct → durable.

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
login stays byte-identical via the no-fingerprint fallback regardless. (NB: the two closures
differ in shipping defaults — `makeLiveWalkBrowser` defaults firstName='A'/lastName='B', the inline
one has none — so collapsing changes behavior on the no-input path; lock whichever is kept with a test.)

**S4 — prove the unification actually RUNS, not just the fallback.** OrangeHRM's fields are
literally named "Username"/"Password" — identical to the hardcoded strings — so an authored input
`elementFp` would be delivered by the back-compat fallback anyway, and the unified path would never
be exercised. Phase 3 MUST add a walk-live test where an input affordance's
`elementFp.name` (the accessible name) DIFFERS from both its `label` and the hardcoded strings,
asserting the field still resolves — proving the fingerprint path runs. Also: `findByRoleAndName`
is first-match-wins today; the fingerprint path should escalate on >1 (consistency with resolveStep)
— test a two-same-name-field page.

## `dev verify --session` (S8) — the live uniqueness backstop for hand-authored maps

graph-edit is offline so it can't check live uniqueness; `dev verify` is the only place a
hand-authored `elementFp` is checked against a real page. Spec it as a normal verb (uniform
JSON stdout + cli-spec registration + MCP-generated, per CLAUDE.md CLI rules). **S5 — v1 is
single-page** (the `--session` browser is on ONE page), so it verifies exactly the matched state:
- **Input:** `--node <id>` + `--session <S>`. Snapshot the session's current page; run
  `matchState(snapshot, store.statesForNode(node))` (the existing `explorer/fingerprint.ts:15`)
  to identify WHICH stored state we're on.
- **Output (stdout):** ONE state entry —
  `{ status, node, state: <id|null>, affordances: [{ id, unique: bool, matchedRefs: [refs] }] }`.
  For each navigate/input affordance of the matched state, run `resolveStep` against the live
  snapshot; `unique:false` lists every ref its `elementFp` matched (>1 or 0).
- **Exit codes:** 0 = matched state, all affordances unique · 3 = matched but some non-unique,
  OR `matchState` returned `none`/`ambiguous` (ran fine, nothing conclusive to verify) · 2 =
  error (no session / unknown node). Multi-state drive-through (walk each state, verify each) is
  an explicit follow-up.

## Migration

- Additive: `states.affordances` is already a JSON blob → absent `elementFp` => null => legacy
  path; the `edges.element_fp` column is added via the existing idempotent migrate() (nullable).
- saucedemo keeps working unchanged (name-only fallback; its affordances have no `elementFp`).
- OrangeHRM: author login affordance with `elementFp:{role:'button',name:'Login'}` → resolves
  uniquely (heading excluded) → login works; PIM-table buttons get `elementFp` with `near` →
  **unique-content rows resolve; content-identical rows correctly escalate** (S3: 12/50 in the
  fixture) — both proven by the prototype against the committed fixture.

## Testing

- **resolve + deriveNear (the proof) — Phase 1, PURE helpers:** a vitest test READS the two
  committed fixtures and asserts the exact refs the prototype proved — MATCH: SD Backpack→e54,
  Bike Light→e66, Fleece→e90; OH edit-row→e288, delete→e290. DERIVE round-trip:
  `deriveNear(target)` → `resolveByNear`/`anchorScope` (the PURE helpers, mirroring the prototype
  — D7a: NOT `resolveStep`, which isn't rewritten until Phase 2) → same ref, for each. D3:
  `deriveNear` for the OH edit button returns an id-like text (`\d{3,}`), not the free-text
  first-name. S3: ≥1 content-identical PIM row → `deriveNear`→null → escalate (locks the honest
  limit as proven behavior). This ports `docs/superpowers/artifacts/fingerprint-algo-prototype.mjs`
  into the real code (no hand-drawn fixtures; locked to real bytes).
- resolveStep units: legacy name-only unchanged (the hard invariant — `resolve.test.ts`/
  `replay.test.ts` stay green untouched); role+name disambiguates heading-vs-button; testId step
  SKIPPED when absent (S2 guard); 0-match → escalate; residual >1 → escalate. NO index test.
- snapshot: `depth` parse; `anchorScope`/`resolveByNear` over the nested fixtures AND a
  flattened fixture (asserts 0 hits → escalate, never a wrong match).
- self-heal (B1/S1/S2): the heal writes `{role,name,near}` onto the owning AFFORDANCE
  (`recordElementFp`), re-`upsertState`; a re-resolve after a step-5 heal resolves WITHOUT
  re-escalating — using a saucedemo/OrangeHRM-shaped fixture that has NO edge row (proving the
  affordance-write path, since `UPDATE edges` would no-op). The three existing tests asserting
  `selectorCache==='Shopping cart'` migrate to assert the affordance `elementFp`. `IMapStore`
  interface decl updated.
- edit.ts: `elementFp` round-trips through graph-edit.
- walk-live (S4): an input affordance whose `elementFp.name` DIFFERS from its label AND from the
  hardcoded strings still resolves (proves the unified path RUNS, not the fallback); a
  two-same-name-field page escalates (>1) rather than first-match-wins; saucedemo login
  byte-identical via fallback.
- Live e2e (gated): OrangeHRM login→dashboard→PIM walk completes; saucedemo walk still completes.

## Phasing (implementation order, once spec approved)

1. snapshot `depth` + `ancestorsOf`/`anchorScope`/`resolveByNear` + **`deriveNear`** (+ tests
   reading the committed fixtures — the ported MATCH + DERIVE-round-trip + S3 proof; + a
   flattened fixture for safe degradation). Pure, no thread-through/heal dependency.
2. `ElementFingerprint` type (field `elementFp` — NEVER `fingerprint`, S7) + Edge thread-through
   (types/makeEdge/projection/`edges.element_fp` column + `upsertEdge` write + `rowToEdge` parse
   + dedup) + `resolveStep` rewrite with the legacy-edges-green hard-invariant + **self-heal via
   `recordElementFp` writing the owning AFFORDANCE (B1), `deriveNear` at heal**. S1 fallout in
   THIS phase: update `IMapStore` decl + migrate the 3 `recordSelector`/`selectorCache` tests.
   Fixes OrangeHRM heading-vs-button + the PIM-table rows.
3. graph-edit `elementFp` authoring + BOTH walk-live credential closures on `elementFp` (+ the
   S4 name≠label test); author OrangeHRM (login + PIM buttons) + verify the walk live end-to-end.
4. recording auto-captures `elementFp` (B4 — the recovery chain): extend `use click`/`ActionRef`
   to recover role+name from `fromSnapshot` by ref-lookup (today cli.ts passes `{role:'',
   name:null}`), compute `near` via the SHARED `deriveNear`, thread through
   `ActionEffect`→`analyseActionEffects`→graph-edit payload (+ tests).
5. `dev verify --session` (S5 single-page spec above) + cli-spec registration; docs (CLAUDE.md
   principle #3 amended: "store a durable element fingerprint (role+name+content-anchor `near`);
   cache disposable selectors; escalation stays the permanent backstop for true ambiguity").

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
