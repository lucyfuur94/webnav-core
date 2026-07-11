# Subtree-Template Induction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Complete the repetition principle at the subtree scale (spec `2026-07-11-subtree-templates-design.md`): repeated sibling subtrees fold into typed templates, personalized pages (dashboards/grids/card-lists) merge on their template identity, and `foldRepeats`/`enumeratedNames` are subsumed and deleted.

**Architecture:** One new pure pass in `src/explorer/infer.ts` (tree from depths → two-level structural signatures → sibling folds), consumed by `draftFromEffects` at four sites (affordance emission, reveal children, interior-synthesis skip, fingerprint exclusion) plus identity-face normalization in the dispose/cluster predicates only.

## Global Constraints (locked design — do not re-decide)

- **Tree:** parent of node i = nearest preceding node with lower `depth` (the containment idiom used everywhere).
- **Two signature levels, computed bottom-up in one pass:**
  - **L1 (named):** `role` + names of CONTROL-role nodes kept verbatim (CONTROL_ROLES = existing set in infer.ts) + sorted multiset of children's L1 sigs. Non-control names (headings, links, text) abstracted to bare role.
  - **L2 (abstracted):** `role` + sorted multiset of children's L2 sigs — ALL names abstracted.
- **Fold rules (per shared parent):** (a) ≥2 sibling nodes sharing an L1 sig → fold `level:'named'` (identical repeated units — chart widgets with identical control names; 'Expand drilldown' ×25). (b) Among the still-unfolded siblings: ≥3 sharing an L2 sig with DISTINCT L1 sigs → fold `level:'abstracted'`; the name-bearing differences are the param slots (the "OS Remove/Revenue Remove" class). Thresholds: named ≥2, abstracted ≥3 — evidence-scaled, documented at definition.
- **Fold output per group:** `{ sig: string(8-char hash of the firing level's sig), level, count, memberIndices, label }`. Label: abstracted-level → longest common trailing word of the varying names (reuse/port the suffix logic) else the unit's role; named-level → first stable control name in the unit else role. Affordance scope: `'widget'` when the unit subtree has ≥2 nodes, `'row'` for single-node (leaf) units — preserves existing `scope:'row'` semantics.
- **Identity-face normalization applies ONLY in the dispose predicate and SPA-split clustering** (not templateCore, not stored faces, not fingerprints): drop tokens contributed by folded member nodes; add ONE `widget:<sig>` token per distinct fold sig (presence, not count — 3-widget and 5-widget dashboards must not split on count).
- **Fingerprints:** tokens of folded member nodes are excluded from candidates (extends the Task-15 exclusion); `widget:*` tokens are never fingerprint material.
- **Deletions:** `foldRepeats` and `enumeratedNames` are REPLACED by the general pass — delete them and re-point all consumers; their behavioral tests are REPLACED by subtree-fold equivalents (the varying-suffix chip fixture must still fold, now via the abstracted level).
- All prior invariants hold: zero site tokens (guard test), thresholds documented, provisional honesty, anti-merge safety (dashboard-list vs viewer stays split — list rows fold to a DIFFERENT sig than viewer widgets), `npm test` + tsc green each task, commits by `dikshant.y` ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: infer.ts — subtree signatures + folds (executor: opus)

**Files:** modify `src/explorer/infer.ts`, `tests/explorer/infer.test.ts`.
**Produces:** `export interface SubtreeFold { sig: string; level: 'named'|'abstracted'; count: number; memberIndices: number[]; label: string; unitSize: number }`; `export function subtreeFolds(nodes: SnapNode[]): { folds: SubtreeFold[]; foldedIndices: Set<number> }` (foldedIndices = every node index inside any folded member subtree). Pure; no draft.ts changes.

TDD fixtures (write complete):
1. Dashboard-shaped: container with 3 widget subtrees, each `{heading "<Title i>", button "Download chart as PNG", button "Full screen"}` (titles differ) + a page-level `button "Setup"` → ONE named-level fold, count 3, unitSize ≥3, label 'Download chart as PNG' (or unit role — pin what the rule yields), Setup NOT folded.
2. Leaf chips: 7 buttons "X Remove" varying prefixes → abstracted-level fold, label 'Remove', scope-relevant unitSize 1; 2 such buttons → NO fold (threshold).
3. Identical-name repeats: 25 `button "Expand drilldown"` siblings → named-level fold count 25.
4. Nested: widgets containing repeated rows → inner rows fold AND outer widgets still fold (bottom-up: inner fold sig contributes to the parent's sig deterministically — members of one fold share it).
5. Negative: 3 siblings with genuinely different control sets → no fold at either level.
6. Mixed-parent: same-sig subtrees under DIFFERENT parents do not fold together.

### Task 2: draft.ts — consume folds, delete old mechanisms (executor: opus)

**Files:** modify `src/explorer/draft.ts`, `src/explorer/infer.ts` (deletions), tests both.
Re-point: (a) interior synthesis skips `foldedIndices` and emits ONE affordance per fold `{label, kind: childKind(unit's dominant control role) or 'mutate', scope: 'widget'|'row' by unitSize, elementFp: null}`; (b) reveal children de-valuing uses `subtreeFolds(addedNodes)` (delete enumeratedNames); (c) fingerprint exclusion uses foldedIndices' tokens; (d) delete `foldRepeats` + its import sites. Replace old tests with subtree equivalents (list them in the report). The existing acceptance + draft suites must stay green EXCEPT tests pinning the deleted helpers by name.

### Task 3: identity normalization + real-data acceptance (executor: opus)

**Files:** modify `src/explorer/draft.ts` (dispose + clusterFaces predicates only), `tests/explorer/draft.test.ts`, `tests/acceptance/progneo-local.test.ts`.
1. Normalize faces inside the dispose predicate + SPA-split clustering per the Global Constraints. Mutation-pinned anti-merge tests must still fail-on-revert (verify by running them with normalization stubbed off — state the check in the report).
2. Synthetic: two same-key-template pages whose faces differ only by widget instances (different titles, same widget sigs) → MERGE; list-page vs viewer-page (row-sig vs widget-sig) → STILL SPLIT.
3. **Real-data acceptance additions:** progneo dashboards 1210+1215 → ONE state, ≥2 instances (NOT provisional), widget-scoped affordances present, neither 'Testuser' nor 'Overview Dashboard' anywhere in its fingerprint/label; `report` state unchanged (12/12 ground truth, 'Expand drilldown' now ONE child/affordance); ohrm PIM grid columns intact + row folds present; ae still exactly ONE product-details. Rebuild + graph-edit + graph-show the live progneo map.

### Task 4: viewer + docs (executor: sonnet)

**Files:** `src/dashboard/shell.ts`, `tests/dashboard/shell.test.ts`, `src/cli-spec.ts`, `tests/cli-spec.test.ts`, `docs/STATUS.md`.
Widget-scoped affordances render with a `×N widget` chip (like the `per row` chip); graph-analyse help mentions widget folding; STATUS snapshot entry. SHELL_HTML traps apply (no `${` in inline JS, no backticks in comments, doubled regex escapes).
