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
//   fingerprint: ElementFingerprint | null;   // null => legacy name-only resolution
//   selectorCache stays as-is: the disposable id/class/xpath hint (self-heal)
```

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
   heal must persist enough to resolve role-aware next time. `recordSelector` is extended to
   write the discovered **role+name into the edge row's `fingerprint`** (built from the chosen
   snapshot node's role + name), NOT a bare name into `selector_cache` — otherwise the next
   resolve goes through the legacy name-only retry (`tryName`) and re-collides with the
   heading. (Unchanged limitation: a purely-projected edge with no stored row still can't
   persist a heal — `recordSelector` no-ops on no row; fingerprints make this rarer since
   authored/recorded affordances carry the fingerprint up front.)

`semanticStep` stays (durable prose, drives `--help`/viewer readability). The fingerprint
is the machine key; `semanticStep` no longer needs to encode the name in quotes once a
fingerprint exists (but keep it for legacy + human readability).

## Resolution algorithm (resolveStep rewrite)

Deterministic, zero-LLM, in strict order. Input: the fingerprint (or legacy name) + the
parsed snapshot nodes.

```
1. legacy path: no fingerprint → today's behavior (single name match else null). [back-compat]
2. testId present → match nodes by data-testid; unique? return it.   [layer 2 exact]
3. candidates = nodes where role == fp.role AND name == fp.name.       [layer 1]
   - 1 match  → return it.                                             [OrangeHRM heading-vs-button solved here]
   - 0 match  → escalate (real drift; self-heal can repair).
   - >1 match → go to 4.
4. fp.near present → keep only candidates whose ENCLOSING ROW/CARD also contains a node    [layer 3]
   whose name == fp.near. "Same row/card" = they share the nearest common ancestor at a
   container-ish role (row|cell|listitem|article|generic-with-children) found via depth.
   - exactly 1 candidate's row contains `near` → return it.   [the 50-icon-button table + 6 carts solved here]
   - else → 5.
5. STILL not unique (no `near`, or `near` matched 0 / >1 rows) → TRUE ambiguity. Escalate
   `needs-navigation` naming it ("N 'button ' and no distinguishing text recorded —
   re-author with `near`"). The agent picks; webnav writes the choice back (self-heal).
   This is the only escalation-for-ambiguity path — and per §Authoring it should be rare,
   but it is a PERMANENT, first-class backstop (drift can add a duplicate after authoring,
   and hand-authored maps may be unverified), NOT a "can't happen".
```

`near` containment uses snapshot **indentation depth** (added to `SnapNode`). CRITICAL
over-scope rule (or a `generic` ancestor engulfs siblings → wrong click, not just a miss):
- The target's "row/card" is the **NEAREST (smallest, first walking up) ancestor at lower
  depth** with a container-ish role — stop at the first one, never climb past it to a
  larger wrapper. (`generic` is in the role set because saucedemo's per-card wrapper is a
  `generic` — but it's bounded by "nearest", so the per-card generic wins over the
  list-level generic.)
- The subtree tested for `name == fp.near` is bounded by the **next sibling at that
  container's depth** — so card A's subtree ENDS where card B begins; a `near` belonging to
  card B can never fall inside card A's tested region.
- Then: exactly 1 candidate whose bounded row-subtree contains `near` → return it; 0 or >1 →
  step 5 (escalate). On a FLAT page (no lower-depth container ancestor) `rowContains` returns
  false for all → >1 candidates → escalate (degrades safely, never wrong-match).
Container-ish roles: `{row, cell, listitem, article, grid, table, generic}`. Pure structural, no LLM.

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

## Anchoring is buildable — measured, not assumed (2026-06-13)

An earlier review feared the a11y snapshot is always flattened (one GitHub fixture showed
every node at column 0), making `near` inert. Measured against the pages that actually HAVE
the identical-sibling problem, that fear was overgeneralized — the structure to anchor on IS
present exactly where needed:

- **saucedemo inventory — 6× `button "Add to cart"`.** Each nests in a generic card (indent
  10→12) alongside `link "Sauce Labs Backpack"` + `generic "$29.99"`. `near:"Sauce Labs Backpack"`
  uniquely picks that row's button. ✅
- **OrangeHRM PIM table — 50× `button ""` icon buttons** (Font-Awesome glyph names, so role+name
  is useless). Each nests in `cell`→`row` (indent 18→16→14) whose sibling `cell` carries the
  employee id `"444444"`. `near:"444444"` (or the employee name cell) uniquely picks the row. ✅
- **GitHub repo page (the flattened fixture).** Fully flat — BUT every link there is already
  distinct by name, so it never reaches layer 3. Flattening only co-occurred with *not needing*
  anchoring. ✅

Honest limit: a page that is BOTH flattened AND has identical siblings with no distinguishing
text in range would fall to step 5 (escalate). That's correct — it's genuine ambiguity, and the
agent-pick + write-back handles it. We anchor on CONTENT, never on position/index, so a stored
`near` survives row reordering (the churn trap an index-based anchor would create).

## Snapshot parser change (src/playwright/snapshot.ts)

`SnapNode` gains `depth: number` (indent level — currently `parseSnapshot` does `line.trim()`
and discards it; we capture leading-space count BEFORE trimming). New helper
`rowContains(nodes, candidateIndex, nearName) => boolean`: walk up from the candidate to its
nearest container-ish ancestor (lower depth, role in {row,cell,listitem,article,grid,table,
generic}), then test whether any node within that ancestor's subtree has `name === nearName`.
Also surface `testId`/`placeholder` if playwright-cli emits them in the snapshot line
(investigate; if absent in the a11y snapshot those layers degrade to unavailable and we rely
on role+name+`near` — which the measured evidence shows fixes both motivating cases).

## graph-edit / edit.ts

`EditAffordanceObj` gains optional `fingerprint`. The existing gates-author-needs logic
(2026-06-13 fix) is unaffected. `toAffordance` passes the fingerprint through.

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

## Migration

- Additive column on the affordance JSON (states.affordances is already a JSON blob — no
  schema migration needed; absent field => null => legacy path).
- saucedemo keeps working unchanged (name-only fallback). Optionally re-record it to gain
  fingerprints, but not required.
- OrangeHRM: re-author login affordance with `fingerprint:{role:'button',name:'Login'}` →
  resolves uniquely → walk completes.

## Testing

- resolveStep: legacy name-only (unchanged); role+name disambiguates heading-vs-button
  (OrangeHRM, unit fixture); `near` disambiguates N identical (role,name) siblings using
  fixtures built from the REAL captured structures (the 6 saucedemo cards; the 50-row
  OrangeHRM table with id cells); testId exact; 0-match → escalate; residual >1 (no/failed
  `near`) → loud re-author escalation. NO index-based test (index is not a resolver).
- snapshot: `depth` parse; `rowContains` over a nested fixture AND a flattened one (asserts
  it returns false, not a wrong match, when there's no container).
- edit.ts: fingerprint round-trips through graph-edit (incl. `near`).
- walk-live: credential fill resolves fields by input-affordance fingerprint; falls back to
  hardcoded names when absent.
- recording: a recorded click captures role+name (+ `near` when siblings collide) — unit
  with a fake snapshot containing duplicate (role,name) inside distinct rows.
- Live e2e (gated): OrangeHRM login→dashboard walk completes; saucedemo walk still completes.

## Phasing (implementation order, once spec approved)

1. snapshot `depth` + `rowContains` (+ tests, nested & flattened fixtures).
2. `ElementFingerprint` type + Edge thread-through (types/makeEdge/projection/edges column) +
   `resolveStep` rewrite with legacy fallback + fingerprint-aware `recordSelector` (+ tests) —
   fixes OrangeHRM heading-vs-button once its affordance has a fingerprint.
3. graph-edit fingerprint authoring + input-affordance fingerprint in walk-live (+ tests);
   re-author + verify OrangeHRM login→dashboard walk live end-to-end.
4. recording auto-captures the fingerprint (+ `near` on sibling collision) (+ tests).
5. `dev verify --session` uniqueness check; docs (CLAUDE.md principle #3 amended:
   "store a durable element fingerprint (role+name+content-anchor); cache disposable
   selectors; escalation stays the permanent backstop for true ambiguity").

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
