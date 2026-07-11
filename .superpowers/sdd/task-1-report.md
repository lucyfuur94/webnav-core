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
