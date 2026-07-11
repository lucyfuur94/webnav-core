# Grammar test suite — Phase-1 report

Source: `docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md` (Matrix + FIXTURES section).
Scope: the Tier-1 "~10 highest-value" fixtures, built first per the task brief.

## Files created

- `tests/grammar/pickers.test.ts` — Pickers & composite inputs (rows 17/19/22, 18)
- `tests/grammar/collections.test.ts` — Collections & data display (rows 44/2/59)
- `tests/grammar/chrome.test.ts` — Page structure & chrome (rows 53/54/55/56, OQ1 probe)
- `tests/grammar/archetypes.test.ts` — Page archetypes (rows 69/63, 73/74/75, 84, X4 probe)
- `tests/grammar/overlays.test.ts` — Overlays & transient containers (rows 29/30/31, 27/28, X8 probe)
- `tests/grammar/gaps.test.ts` — Gap-repro fixtures (row 26/X1, row 79)
- `tests/grammar/disclosure.test.ts` — Disclosure & view switching (rows 41/4)

No changes to `src/`. All fixtures drive the real `draftFromEffects` pipeline (recorded
`StoredActionEffect[]` → `DraftGraph`), reusing the idiom from `tests/explorer/draft.test.ts`
(YAML-ish snapshot literals via `parseSnapshot`, ≥8 named nodes per landing so
`classifyReadiness==='ready'`, distinct first-URL-segment pages so `inferUrlModel`'s base
inference doesn't collapse fixtures).

## Per-fixture outcome table

| # | Fixture | Matrix rows | Verdict tested | Result |
|---|---|---|---|---|
| 1 | fx-select-portal | 17, 19, 22 | COVERED (options never stored) / MISMATCH (reveal kind) | PASS (options never stored) + 1 `it.fails` (reveal→mutate collapse) |
| — | fx-multi-select probe | 18 | PARTIAL (OQ2) | PASS — documents 2-tag case synthesizes as ordinary mutates (no fold at n<3) |
| 2 | fx-data-grid | 44, 2, 59 | COVERED / PARTIAL (unnamed icon) / MISMATCH (columnheader) | PASS (row fold, near, URL-template edge, honest icon omission) + 1 `it.fails` (columnheader never synthesizes) |
| 3 | fx-app-shell | 53, 54, 55, 56 | COVERED | PASS (one `_shell` record, from-anywhere mesh, no per-page duplication) |
| — | fx-app-shell OQ1 probe | 54 | PARTIAL (OQ1) | PASS — demonstrates a per-page-varying rail is NOT caught by shell extraction (leaks per-page) |
| 4 | fx-detail-template | 69, 63 | COVERED | PASS (provisional→confirmed transition, fingerprint excludes h1 + values) |
| 5 | fx-overlay-family | 29, 30, 31 | COVERED | PASS (reveal-with-children ×3, URL-unchanged, commit escalation, opener commit-word match) |
| 6 | gx-undeclared-portal | 26 (GAP, X1) | GAP (documented failure) | PASS — reproduces the pollution (value click leaks); also narrows the claim (opening click IS gated by `enumeratedNames`, only a later recorded click on the already-open portal leaks) |
| — | gx-canvas | 79 (GAP) | GAP (out of scope, posture) | PASS — canvas/application zone contributes nothing; surrounding chrome maps normally |
| 7 | fx-wizard-guarded | 73, 74, 75 | COVERED + X4 probe | PASS (linear chain + needs/acceptsInput, commit stop at check-answers, unaddressable-in-spirit confirmation leaf) + X4 hazard reproduced |
| 8 | fx-login-gate | 84 | COVERED | PASS (needs-credentials wiring, no phantom drift, no leaked value literals) |
| 9 | fx-tabs-both | 41, 4 | COVERED | PASS (navigate-vs-reveal decided by observed effect, not role; segmented control mutates) |
| 10 | fx-menu-attribution | 27, 28 | COVERED / MISMATCH (menuitemcheckbox/radio) | PASS (plain menuitem + submenu-item captured, dedup on re-click) + 1 `it.fails` (check/radio menu items silently dropped) |
| — | X8 probe (persistent role=menu) | 28, 56 | COVERED | PASS — shell gate correctly wins over the menu=transient-overlay declaration |

**Fixtures authored: 10 Tier-1 + 4 bonus probes (fx-multi-select-lite, fx-app-shell-OQ1, gx-canvas, X8-precedence) = 14 fixture groups, 56 tests, 7 spec files.**

## MATRIX-MISMATCH findings (3)

All three are marked `it.fails` with an inline comment naming the exact code location; the
"current (mismatched) behavior" is additionally pinned as a passing test so any future fix is a
deliberate, visible diff (not a silent regression).

1. **Reveal collapses to mutate when all children are value-domain (row 17/26).**
   `REVEAL_CHILD_ROLES` (`src/explorer/draft.ts:32`) excludes ARIA `option`, and any surviving
   role-eligible children get stripped by `enumeratedNames` when they're a ≥3-member same-role
   value domain. With zero children left, the opener falls through to `kind: 'mutate'` instead of
   `'reveal'`. The matrix's "options never stored" half holds; the "opener is a reveal" half does
   not for an option-only (or value-only) portal. Reproduced twice: `pickers.test.ts` (native
   listbox) and `gaps.test.ts` (role-less portal checkboxes).
   — `tests/grammar/pickers.test.ts`, `tests/grammar/gaps.test.ts`

2. **`columnheader` role is invisible to interior synthesis (row 44).**
   The declared-interactive-control filter (`src/explorer/draft.ts:854-855`) only accepts
   `INPUT_ROLES` ∪ `'button'`. A sortable `columnheader` (the real a11y role for a data-grid sort
   control) is neither, so it never synthesizes as an affordance at all — not folded, not gated,
   silently absent. The matrix's "headers mutate" claim does not hold for this role today.
   — `tests/grammar/collections.test.ts`

3. **`menuitemcheckbox`/`menuitemradio` are missing from `REVEAL_CHILD_ROLES` (row 27).**
   Same set as finding 1 (`src/explorer/draft.ts:32`): it lists `button, menuitem, link, tab,
   checkbox, combobox, textbox` but neither ARIA menu-item-check/radio role. A revealed menu's
   check/radio items (e.g. "Track changes", "View: Edit") are silently dropped from the opener's
   children, even though they carry real accessible names and would resolve fine.
   — `tests/grammar/overlays.test.ts`

All three share one root cause shape: a **role allow-list that's narrower than the ARIA roles the
matrix's own canonical structures use** (`REVEAL_CHILD_ROLES` twice, the interior-synthesis
control filter once). Fixing item 1 and 3 together (adding `option`, `menuitemcheckbox`,
`menuitemradio` to `REVEAL_CHILD_ROLES`) is a one-line surface fix at the same site; whether an
empty-after-gating opener should still classify `reveal` vs `mutate` is a separate design call the
controller should make explicitly.

## Other real findings (not matrix-mismatches, but worth flagging)

- **Fold-label mechanics differ between the raw-tree test in `infer.test.ts` and what
  `draftFromEffects` actually folds on.** Affordance emission runs `subtreeFolds` against
  `p.coreNodes` — the *named-only, core-filtered* node list — not the raw snapshot. Container
  nodes (unnamed `table`/`row` wrappers) are dropped before folding, so the tree shape collapses
  differently than `infer.test.ts`'s raw-tree fixtures suggest. In `fx-data-grid` this produced a
  correct-but-differently-labeled fold (`"widget Edit"` via `commonTrailingWords`, not a bare
  `"Edit"`) rather than a wrong one — still honest, just a nuance worth knowing before authoring
  more grid/table fixtures.
- **`inferUrlModel`'s base inference is sensitive to low URL diversity.** A fixture with only 2
  distinct URLs where one dominates (4-5 occurrences vs 1) can infer a false shared "base" across
  unrelated path segments, collapsing everything to `/`. Every fixture in this suite that needed a
  single isolated page (`fx-overlay-family`) had to add 2 decoy distinct-first-segment pages to
  give the model enough evidence — matching the pattern every fixture in `draft.test.ts` already
  follows. Not a matrix mismatch (the matrix doesn't claim anything about base-inference
  robustness on sparse data), but a real authoring gotcha for Tier-2/3 fixtures.

## Test summary

```
npx tsc --noEmit         → clean
npm test (full suite)    → 775 passed, 7 skipped (pre-existing live-e2e skips), 0 failed
tests/grammar/*          → 56 passed (7 spec files), including 3 it.fails counted as passing
```
