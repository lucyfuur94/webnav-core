# Phase 2 — Extension Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** The self-learning fallback (program spec `2026-07-11-future-proof-program.md` Phase 2): analyse reports what it couldn't infer as a structured `unknowns` section; agents extend coverage via DECLARATIVE pattern packs (data, never code) through a defined, test-gated, PR-reviewed process.

## Global Constraints (locked)

- **The core's effect set is CLOSED.** v1 pack types map structural triggers onto exactly TWO existing effects: `overlay-open` (feeds the openedOverlay detection) and `value-domain` (feeds the folded/value exclusion sets). Error-fingerprint packs (X11) are DEFERRED (their text-literal triggers need a carve-out the schema doesn't have yet); state-identity hints are OUT (too dangerous for data).
- **Trigger schema is structural-only:** roles, containment (root/contains with min counts), bracket-attribute presence (e.g. `aria-sort`), and evaluation context (`diff.added` | `overlay` | `landing`). The schema has NO fields for hostnames, URLs, or free text; the lint REJECTS any string value that is not a known ARIA role or attribute name. This is what keeps site-rules impossible.
- Packs load deterministically (sorted filenames) from `packs/patterns/core/*.json` (merged, shipped) and `packs/patterns/proposed/*.json` (local, applies immediately); zero LLM at runtime; a pack can only make the engine MORE conservative about storing data (both effects gate storage), never mint edges/states.
- Every pack entry REQUIRES an embedded fixture (snapshot fragment) + expected effect; `dev pattern-lint` validates schema + forbidden-value scan + runs the fixture through the real hook.
- Suite + tsc green per task; commits by `dikshant.y` ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; guard test stays green (packs are data, src stays site-free).

### Task 1: pack schema + loader + engine hooks (executor: opus)

**Files:** new `src/explorer/patterns.ts` (schema types, loader, lint, trigger evaluator), `src/explorer/draft.ts` (two hook points), `packs/patterns/core/.gitkeep`, tests.
- Trigger evaluator: pure — given a pack entry + the evidence nodes for its context, return match/no-match using the SAME containment idiom (nearest-lower-depth) as the core.
- Hook 1 (`overlay-open`): evaluated on `diff.added` nodes when the built-in detection declined — a matching pack flips `openedOverlay` true (detection only; the transient set stays maximal as built).
- Hook 2 (`value-domain`): evaluated on overlay/reveal-children candidates and interior-synthesis candidates — matching nodes join the excluded/value sets (never stored).
- Loader caching per draft run; missing/invalid pack = loud error listing the lint failure (never silently skipped).
- Tests: schema lint (accepts a valid entry; rejects hostname/text/url values with named reasons); evaluator fixtures; hook integration (a synthetic div-soup overlay undetected by core, detected via pack → containment holds); determinism (two loads, same result).

### Task 2: `unknowns` report in analyse (executor: sonnet)

**Files:** `src/explorer/draft.ts` (collect), `src/cli.ts`/`src/cli-spec.ts` (surface + help), tests.
- DraftGraph gains `unknowns: Unknown[]`: each = `{ kind: 'undetected-overlay' | 'ambiguous-cluster' | 'unresolved-affordance' | 'degenerate-landing', evidence: <minimal snapshot fragment (the relevant nodes only, capped)>, context: <page label + what the core tried>, extensionPoint: 'overlay-open' | 'value-domain' | 'core-design' }`.
- Sources: openers that stayed mutate with ≥N-node named added-diffs (detection declined); needsFix entries; self-verify `_warning`s; SPA-split no-distinguishing-heading clusters. Cap evidence size (the report must stay pasteable).
- graph-analyse help: teach the loop (unknown → pattern-propose → local pack applies → PR upstream).

### Task 3: `dev pattern-propose` + EXTENDING.md + the first real pack (executor: sonnet)

**Files:** `src/cli.ts`/`src/cli-spec.ts` (verb), `docs/EXTENDING.md`, `packs/patterns/core/date-picker-divsoup.json` (the X10 worked example), tests + one grammar fixture.
- `dev pattern-propose --from-unknown <analyse-json-path>#<index> --name <slug>`: scaffolds `packs/patterns/proposed/<slug>.json` pre-filled with the unknown's evidence as the fixture + a TODO trigger, runs pattern-lint, prints the checklist (fill trigger → lint → re-analyse → grammar test → PR command `gh pr create` with a generated body citing evidence). No auto-PR — prints the command.
- `docs/EXTENDING.md`: the agent process end-to-end + the honest boundary (inexpressible in schema → file a core-design issue with the fixture).
- The X10 worked example: a real div-soup date-picker pack entry (role-less grid of ~28-31 same-shape day cells inside an added subtree → value-domain), with a grammar fixture proving days never become affordances while the opener stays reveal (via the pack's overlay-open sibling entry if needed).

### Task 4: acceptance + final review + merge (orchestrator)

Full suite, real-data acceptance (packs present but no behavior change expected on the three corpora — verify zero-delta with core packs limited to the date-picker example), whole-branch review, STATUS entry, merge + push.
