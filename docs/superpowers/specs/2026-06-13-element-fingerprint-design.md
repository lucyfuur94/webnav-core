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
  // layer 3 — disambiguator for identical (role,name) siblings; null when the target is
  // already unique by layers 1–2 (the common case)
  anchor?: {
    container: { role: string; name: string };  // nearest labeled ancestor, e.g. {section,'Dependents'}
    index?: number;                              // 0-based among matches WITHIN that container; last resort
  } | null;
}
// On Affordance:
//   fingerprint: ElementFingerprint | null;   // null => legacy name-only resolution
//   selectorCache stays as-is: the disposable id/class/xpath hint (self-heal)
```

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
   - 1 match  → return it.                                             [OrangeHRM solved here]
   - 0 match  → escalate (real drift; self-heal can repair).
   - >1 match → go to 4.
4. fp.anchor present → keep only candidates inside a `container` node   [layer 3 disambiguate]
   (role+name match on the nearest enclosing labeled node, via snapshot indentation).
   - 1 → return it.  - >1 and anchor.index set → return candidates[index].  - else → 5.
5. STILL >1 and no stored disambiguator → this is TRUE ambiguity the MAP failed to make
   unique. Per the authoring-uniqueness rule below this should not happen for an
   authored/recorded step; if it does, escalate `needs-navigation` with a question that
   NAMES the ambiguity ("3 'button +' inside no recorded anchor — re-author with an
   anchor"). This is the only remaining escalation-for-ambiguity path.
```

`anchor` containment uses the snapshot's **indentation nesting** (parseSnapshot already
keeps `raw`; we add parent tracking — a child is "inside" the nearest preceding line at a
lower indent whose role+name match the anchor container). Pure structural, no LLM.

## Authoring guarantees uniqueness (the chosen rule)

Decision (2026-06-13, with user): **true ambiguity is prevented at authoring/record
time, not escalated at walk time.** Concretely:

- **Recording** (`use click` while a session records): when the agent clicks an element,
  capture its FULL fingerprint from the live snapshot — role, accessible name, testId,
  AND, if >1 element shares that (role,name) on the page, automatically compute the
  `anchor` (nearest labeled ancestor; add `index` only if the anchor alone isn't unique).
  So a recorded step is unique-by-construction.
- **`graph-edit`** (hand authoring): accept a `fingerprint` object on an affordance.
  VALIDATE at write time against… nothing live (graph-edit is offline) — so instead
  `graph-edit` requires `role`+`name` minimum, and `dev outline`/a new `dev verify`
  check flags any state whose stored fingerprint is not unique against a provided live
  snapshot. (Authoring uniqueness is enforced where a live page is available: recording,
  or a `dev verify --session` pass.)
- **Walk** therefore assumes the map is unique and resolves deterministically; step 5
  above is the safety net that turns a residual ambiguity into a loud "re-author"
  message, not a silent wrong click.

## Snapshot parser change (src/playwright/snapshot.ts)

`SnapNode` gains `depth: number` (indent level) and we expose a helper
`nearestContainer(nodes, childIndex, {role,name})` for anchor matching. Also surface
`testId`/`placeholder` if playwright-cli emits them in the snapshot line (investigate;
if not present in the a11y snapshot, testId/placeholder layers degrade to unavailable and
we rely on role+name+anchor — still fixes both motivating cases).

## graph-edit / edit.ts

`EditAffordanceObj` gains optional `fingerprint`. The existing gates-author-needs logic
(2026-06-13 fix) is unaffected. `toAffordance` passes the fingerprint through.

## Migration

- Additive column on the affordance JSON (states.affordances is already a JSON blob — no
  schema migration needed; absent field => null => legacy path).
- saucedemo keeps working unchanged (name-only fallback). Optionally re-record it to gain
  fingerprints, but not required.
- OrangeHRM: re-author login affordance with `fingerprint:{role:'button',name:'Login'}` →
  resolves uniquely → walk completes.

## Testing

- resolveStep: legacy name-only (unchanged); role+name disambiguates heading-vs-button
  (the OrangeHRM case, as a unit fixture); anchor disambiguates N identical (role,name)
  siblings; index tiebreaker; testId exact; 0-match → escalate; residual >1 → loud
  re-author escalation.
- snapshot: depth/nesting parse; nearestContainer.
- edit.ts: fingerprint round-trips through graph-edit.
- recording: a recorded click captures role+name (+anchor when siblings collide) — unit
  with a fake snapshot containing duplicate (role,name).
- Live e2e (gated): OrangeHRM login→dashboard walk completes; a re-recorded saucedemo
  walk still completes.

## Phasing (implementation order, once spec approved)

1. snapshot `depth` + `nearestContainer` (+ tests).
2. `ElementFingerprint` type + resolveStep rewrite with legacy fallback (+ tests) — this
   alone fixes OrangeHRM once its affordance has a fingerprint.
3. graph-edit fingerprint authoring (+ test); re-author + verify OrangeHRM walk live.
4. recording auto-captures the fingerprint (+ anchor on sibling collision) (+ tests).
5. `dev verify --session` uniqueness check; docs (CLAUDE.md principle #3 amended:
   "store a durable element fingerprint; cache disposable selectors; author uniqueness").

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
