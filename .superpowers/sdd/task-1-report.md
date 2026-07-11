# Task 1 — X1 overlay-by-behavior + 3 grammar-mismatch fixes — Report

**Status:** DONE. `npm test` green (774 passed / 7 skipped), `npx tsc --noEmit` clean, all real-data acceptance (progneo/ohrm/ae) green. No downstream patches — every fix is in the producing stage (`src/explorer/draft.ts`).

## The five locked design rules, as built

### Rule 1 — Transient-subtree tracking (X1, the only wrong-map gap)
`src/explorer/draft.ts`, in the `effects.forEach` affordance pass:
- Added a per-PAGE transient-overlay set: `const transientByPage = new Map<string, Set<string>>()`, keyed by `fromPageKey(e.fromUrl)`, threaded through the existing loop (no new structure, no new file).
- As the effects walk runs in session order: after a NON-navigated effect, its `diff.added` named `role:name` tokens are unioned into that page's set and `diff.removed` tokens subtracted (done post-gate, pre-processing, so an opener never gates ITSELF — its added children only affect the SUBSEQUENT clicks). Navigation clears the from-page's set (`transient.clear()` at the top of the `if (e.navigated)` block).
- The overlay gate for a recorded action is now `clickedInOverlay(fromNodes, e.action) OR (actionTok && transient.has(actionTok))` — the transient set is the OR-arm; the declared-container check (`clickedInOverlay` → `insideOverlay`) stays as the stronger signal. A value click inside a role-less AntD/Bootstrap portal (no `dialog`/`menu`/`listbox` ancestor) now attributes to the OPENER's overlay, not the page body. The gated path keeps the transient set current (a gated click can open a nested overlay / dismiss the current one) before returning.

### Rule 2 — Reveal classification by behavior (mismatch #1, pickers row 17)
Replaced the `children.length ? 'reveal' : 'mutate'` ternary (~draft.ts:760) with `const openedOverlay = addedNodes.some((n) => n.name && n.name.trim())`. An opener whose diff ADDED ≥1 named node is a `reveal` even when NO child survives the child-role filter + value-domain folds (option-only portal → `children: []`). Falls back to `mutate` only when the diff added nothing named.

### Rule 3 — REVEAL_CHILD_ROLES additions (mismatches #1/#3)
Added `menuitemcheckbox`, `menuitemradio` to `REVEAL_CHILD_ROLES` (stateful menu controls = durable repertoire; `childKind` gives them `mutate` — not an INPUT_ROLE, matching matrix row 27 "check/radio items mutate"). `option` deliberately NOT added — options are value domain (rule 2 already handles the option-only reveal); documented inline.

### Rule 4 — columnheader interior synthesis (mismatch #2, collections row 44) — declared-evidence-gated
Interior synthesis now accepts `columnheader` **only when it carries `[aria-sort]`** (`/\[aria-sort/.test(n.raw)`). A sortable header IS the declared sort control (matrix row 44 → mutate). A PLAIN `columnheader` (no aria-sort) is a STATIC table header (matrix row 43) whose name is column DATA → stays in the shadow (`collections.columns`), never an affordance.

**This gate was a DEVIATION forced by real-data evidence (see below).** The plan's rule-4 assumption ("≥2 same-shape headers still fold per the existing pass") does NOT hold: the fold pass discards a columnheader-only fold (columnheader ∉ CONTROL_ROLES → `isTemplateFold` rejects it), so without the aria-sort gate all 7 of the real report's plain columnheaders (its user-selected metrics) leaked as page affordances and broke progneo acceptance. The aria-sort attribute is the matrix's OWN distinction (row 44 says `columnheader[aria-sort]`), site-agnostic and declared-evidence-gated — the correct upstream fix, no count threshold.

### Rule 5 — it.fails flips (RED→GREEN, documented below)

## Per-flip RED/GREEN

- **pickers.test.ts row 17** (opener = reveal for option-only portal): RED — `it.fails` passed as expected-fail on baseline (opener was `mutate`, children=0). GREEN — after rule 2, opener classifies `reveal` with `children: []`; flipped to `it` asserting `kind === 'reveal'` + empty children.
- **overlays.test.ts row 27** (menuitemcheckbox/menuitemradio as reveal children): RED — `it.fails` passed as expected-fail ("Track changes"/"View: Edit" dropped). GREEN — after rule 3, both surface as `mutate` children; flipped to `it` asserting arrayContaining + `kind === 'mutate'`.
- **collections.test.ts row 44** (sortable columnheaders synthesize): RED — `it.fails` passed as expected-fail (columnheaders absent). GREEN — after rule 4, the 2 `[aria-sort]` headers synthesize as `mutate`; flipped to `it` asserting both present with `kind === 'mutate'`.
- **gaps.test.ts row 26/X1** (role-less portal containment): the 3 tests here asserted the POLLUTION honestly on baseline (value leaked + opener mutate). RED baseline confirmed by running before the fix. GREEN — after rule 1 (containment) + rule 2 (opener reveal), rewrote the 3 to assert: value click does NOT leak; opener is `reveal` with `children: []`; neither the reveal children nor a separate recorded click leak.

Each paired "current (mismatched) behavior" honest-pin test was REMOVED where it asserted the now-obsolete wrong behavior (it would fail post-fix).

## New tests
`tests/explorer/draft.test.ts` — one describe (2 tests) pinning the transient-set LIFECYCLE the grammar suite doesn't isolate: (a) a value click inside a role-less popover is gated (transient OR-arm); (b) after the opener DISMISSES the popover (`diff.removed`), a same-named real page control re-emerges (the set correctly shrank). Decoy pages keep URL-base inference stable (grammar idiom).

## Acceptance state
progneo/ohrm/ae real-data acceptance (env-gated, DB present at `~/.webnav/webnav.db`): GREEN. The real report-builder state's page-level affordance count went 33 → 26 after the aria-sort gate (the 7 metric columnheaders correctly excluded from affordances and kept in the shadow); ohrm PIM grid's declared columns still intact in `declaredShadow.collections[0].columns`. Anti-merge / mutation locks untouched.

## Test summary
- `npm test`: 774 passed, 7 skipped (skipped = live/e2e, unchanged). 0 failed.
- `npx tsc --noEmit`: clean.
- `tests/guidelines.test.ts` (zero site tokens in `src/`): green (one iteration needed — removed a "progneo" mention from a code comment).

## Concerns
1. **columnheader deviation from the plan's stated fold mechanism** (documented above): the plan expected columnheaders to fold via the existing pass; they don't. The aria-sort gate is a stricter, more principled upstream fix (matrix's own row-43-vs-44 distinction) and is what keeps progneo acceptance green — but it's narrower than "all sortable headers": a grid that declares sort via a nested `button` inside the `columnheader` rather than the `aria-sort` attribute would synthesize that button (fine) while the header itself stays shadow. No regression; flag for awareness.
2. The `enumeratedNames` overlay value-domain fold (draft.ts) still carries its pre-existing `ponytail:` FOLLOW-UP note (unrelated to this task) — left as-is.

---

## Follow-up (review fix, 2026-07-11): overlay-shape guard + session-boundary clear + kind locks

The task reviewer confirmed a base→head REGRESSION from Rule 2: `openedOverlay = addedNodes.some(named)` had no shape guard, so on real progneo data a filter-tab click that re-renders the grid (`Owned/Shared`, `Standard`) and a click-shows-tooltip (`Download as formatted CSV`) flipped mutate→reveal.

### Fix 1 — overlay-shape guard (src/explorer/draft.ts)
An effect OPENS an overlay iff `diff.added` contains ≥1 named INTERACTIVE node (role ∈ REVEAL_CHILD_ROLES ∪ CONTROL_ROLES ∪ `option`) that is genuinely NEW:
- **churn exclusion** — role:name also in `diff.removed` = a re-paint of existing controls (sort re-render), not overlay content;
- **fold exclusion** (extension beyond the reviewer's stated rule, forced by evidence) — the real tab-switch re-render swaps in DIFFERENT rows (new `link:<report name>` tokens, NOT exact-token churn), but they arrive as ≥2 same-shape row subtrees already caught by `templateFolds` — re-rendered collection DATA, excluded from detection;
- **straggler-unit exclusion** (second live finding) — one real row (`OS and Device Report_clone`) had per-row shape variance (extra cell) and MISSED the fold its 14 siblings formed; its interior link alone flipped the classification. When the added diff folded repeated units (unitSize ≥2), a control nested under another node of the same unit-root role (`row`) is collection data too (nearest-lower-depth ancestor walk, the insideOverlay idiom).
- **DETECTION set ≠ STORAGE set** (documented in a comment): `option` counts for DETECTION (an added option-list is definitely an overlay opening) but options are never STORED as children. `enumeratedNames` value domains are NOT excluded from detection (an added value list IS an overlay signal — the row-17 option-only portal and the gaps role-less checkbox popover both depend on this).

The churn exclusion is also applied to the transient-set ADDS (same seam): a re-render's churned tokens must not enter the transient-overlay set, else later clicks on re-rendered page content would be wrongly gated.

### Fix 2 — session-boundary transient clear (Minor I2)
One line at the top of the affordance `effects.forEach`: the same seq-reset signal the landing pass reads (`e.seq <= effects[i-1].seq`) clears `transientByPage` — a new session is a fresh browser; no overlay survives it.

### Fix 3 — kind assertions (the gap that let the regression ship)
- `tests/acceptance/progneo-local.test.ts`: pins kinds of known recorded actions — `Owned/Shared` + `Standard` = mutate (grid re-render), `Save As / Schedule` + `Add dimensions` = reveal (genuine openers).
- `tests/grammar/collections.test.ts` (row 44): new fixture — a recorded sort click whose diff re-renders the rows (same tokens in added+removed) classifies mutate. RED-verified: fails under the regressed any-named-node guard, passes under the fix.

### progneo kinds, base vs regressed vs fixed

| Action | base (pre-Task-1) | regressed (8735c96) | fixed |
|---|---|---|---|
| Owned/Shared (report-list) | mutate | reveal (children=0) | **mutate** |
| Standard (report-list) | mutate | reveal (children=0) | **mutate** |
| Download as formatted CSV (report-flat) | mutate | reveal (children=0) | **mutate** |
| Save As / Schedule (report-flat) | reveal (4 children) | reveal (4) | **reveal (4)** |
| Add dimensions (report-flat) | reveal (1 child) | reveal (1) | **reveal (1)** |

(base kinds per the reviewer's revert-diff; regressed + fixed verified empirically against ~/.webnav/webnav.db.)

### Verification
- The 3 flipped grammar tests + gaps X1 containment: still green under the new guard.
- Full suite: 775 passed / 7 skipped, 0 failed. `npx tsc --noEmit` clean.
- Real-data acceptance (progneo incl. new kind locks + ohrm + ae): green.

---

## Addendum (2026-07-12) — final-review fix: gridRepaint guard shared with the pack overlay-open hook

**Finding (final whole-branch review, verified on real progneo data):** `packDetectsOverlay` was
consulted on ANY added diff when built-in detection declined, but the F2 `gridRepaint` guard
(collection-role dominance AND ≥1 named row/columnheader) only gated the UNKNOWNS report. The shipped
date-picker pack's overlay-open trigger (`generic` root, `gridcell` min:20) structurally matches a
data-grid REPAINT (Refresh-list re-render: 24 gridcells + rows + columnheaders), so real repaint
clicks flipped mutate→reveal — the exact shape the core's own detection rejects. Falsified the
"packs never flip kinds wrongly" half of the safety claim.

**Fix (upstream, one site, `src/explorer/draft.ts`):** the `gridRepaint` computation moved ABOVE the
`openedOverlay` classification; the pack consult is now
`|| (!gridRepaint && packDetectsOverlay(packsFor(fromLabel), addedNodes))`. The guard is thereby
SHARED by the unknowns report and the pack hook — a collection-repaint diff never reaches pack
overlay-open evaluation. The date-picker's own shape (gridcell-dominant, ZERO rows/headers →
`gridRepaint` false) still passes: the X10 grammar fixture (`tests/grammar/pickers.test.ts`,
"WITH the shipped core pack: the opener classifies reveal") stays green.

**Real progneo numbers (185 effects, 5 sessions), shipped pack loaded:**

| state | pack-less baseline | before fix (with pack) | after fix (with pack) |
|---|---|---|---|
| report-list | 15 affs, Refresh list = mutate | 15 affs, Refresh list = **reveal** (wrong) | 15 affs, mutate (== baseline) |
| dashboard-list | 11 affs, Refresh list = mutate | **12** affs (grew) | 11 affs, mutate (== baseline) |

Full id-stripped draft diff after the fix: ONLY the two intended states differ from the pack-less
baseline — report-flat and dashboard-category's date-range openers flip mutate→reveal (the pack's
purpose), children empty (day values gated). All other states identical.

**Tests added (`tests/explorer/patterns.test.ts`, now 33):**
1. The "pack ONLY ever SHRINKS" invariant test gained a grid-repaint arm: repaint diff + an
   overlay-open pack that WOULD match it structurally → kinds and counts STRICTLY equal the pack-less
   baseline (not ≤ — the pack path is never consulted).
2. Real-shape regression: repaint diff (gridcells+rows+headers) + the SHIPPED core pack loaded from
   `packs/patterns/core` → Refresh-list-style opener stays mutate; in the same run the genuine
   date-picker portal still flips to reveal.
Both tests verified LOAD-BEARING: with the guard reverted they fail (2 failed), with it they pass.

**Docs:** STATUS Phase-2 entry corrected — "never wrong kinds" wording now cites this fix; one line
added noting the gridRepaint guard is shared by core unknowns AND pack hooks.

**Verification:** `npm test` 863 passed / 7 skipped (incl. the site-free guard test — the new comment
was reworded after it caught a site name), `npx tsc --noEmit` clean, grammar suite 59/59.

**Observed while verifying (pre-existing, NOT this fix, flagged for the coordinator):** on
report-flat, the value-domain entry (overlay context) also excises the `Table` reveal's stored
children (Page Size/Search/Flat/Functions/Nested) because they nest inside the same `generic`
subtree as the re-rendered grid's 20+ gridcells. Shrink-only (safety invariant holds; no kind/edge
change) and shipped with Task 3's pack — but it loses real overlay repertoire; the per-page husk
tripwire doesn't see overlay children. If unwanted, the same gridRepaint reasoning could gate
`packValueNames` on the overlay context — deliberately NOT done here (out of the reviewed finding's
scope; would change the shipped pack's Task-3-reviewed behavior).

---

## Addendum 2 (2026-07-12) — should-fix: gridRepaint guard extended to the value-domain overlay-children hook

**Finding (final reviewer, READY-gated should-fix):** the observation flagged in Addendum 1 was
confirmed as a defect — the `Table` reveal's genuine children (Search, Flat, Nested, Functions,
Page Size) were excised to `[]` by the shipped value-domain entry. The Table click's diff carries
rows+columnheaders (it re-renders the grid inside the overlay), i.e. it IS a `gridRepaint` — but the
previous fix only guarded the overlay-open consult, not `packValueNames` at Hook 2a.

**Fix (same reasoning, one line):** the `gridRepaint` computation hoisted above Hook 2a (it only
depends on `addedNodes`); the hook is now
`const packValues = gridRepaint ? new Set<string>() : packValueNames(packsFor(fromLabel), addedNodes)`.
A collection-repaint diff's nodes never reach value-domain pack evaluation for reveal-children. The
guard block is now stated once, shared by ALL diff-based pack evaluation (overlay-open + value-domain)
AND the unknowns report. Hooks 2b/2c (`landing` context over core nodes) are untouched — gridRepaint
is a property of a DIFF, not of a page's core.

**Real progneo verification (185 effects, shipped pack):** report-flat's `Table` reveal children
RESTORED — `[Search, Flat, Nested, Functions, Page Size]`, identical to the pack-less baseline
(previously `[]` with the pack). Full id-stripped draft diff vs baseline now shows ONLY the two
intended date-opener reveals (report-flat `Last 7 Days (CD)…`, dashboard-category `09 Jul 2026 –
10 Jul 2026 UTC`).

**Test added (`tests/explorer/patterns.test.ts`, now 34):** real-shape regression — a Table-style
genuine reveal (diff = controls + rows + headers + 24 gridcells in one `generic` subtree) with the
SHIPPED core pack → `kind: reveal` with children exactly `[Flat, Functions, Page Size, Search]`; and
the genuine date-picker exclusion still bites (a no-rows/headers picker diff: month buttons stored
as children WITHOUT the pack, excised WITH it). Verified load-bearing: reverting the Hook 2a guard
fails the test.

**Logged (no code, per reviewer):**
- **(a) Dedup wart:** a kind-flipped opener appears TWICE in a state's repertoire — the recorded
  session may push the same label as `mutate` in one effect and `reveal` in another, and `pushAff`
  dedups by `kind+label+to`, so both rows survive (visible on report-flat/dashboard-category: the
  pack adds a `reveal` row while the baseline `mutate` row remains). Fix later: label-level dedup
  with reveal-wins (a reveal is strictly more information than a mutate of the same control).
- **(b) `trigger.context` is linted but not ENFORCED at hook dispatch:** `packDetectsOverlay`/
  `packValueNames` evaluate every pack of the matching TYPE regardless of its declared `context`
  (`diff.added` vs `overlay` vs `landing`). Today this is benign (the shipped pack's two entries are
  each only reachable at their intended hooks' shapes), but the field is currently documentation,
  not dispatch — a core-design note: either enforce context at each call site or drop the field from
  the schema.

**Verification:** `npm test` 864 passed / 7 skipped, `npx tsc --noEmit` clean.
