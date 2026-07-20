# Subtree-template induction (design, 2026-07-11 — approved direction, not yet built)

**Status:** direction approved by user; implementation is the next engine increment after profile-status.

## The sustainability question this answers

User (2026-07-11): *"say this is for the analytics SPA, some other website comes with some other structure, we keep on supporting something or the other and updating code — how is this sustainable?"*

The answer the design commits to: webnav's inference is ONE principle — **repeated structure = template; the varying residue = data** — applied at every scale of the containment hierarchy. Site-specific rules never converge; scale-completion does, because sites are template engines and template output has finitely many structural shapes. Current coverage:

| Scale | Mechanism (shipped 2026-07-11) |
|---|---|
| site | shell extraction (repeats across pages) |
| page | template cores (repeats across visits); URL×structure templates (repeats across instances) |
| named siblings | `foldRepeats` (varying-prefix names, e.g. "X Remove" ×7) |
| **subtree** | **this spec — the last uncovered scale** |

After this, the principle operates at token < subtree < page < site; there is no next scale. Residual maintenance is thresholds (self-annealing with more observations) and honest degradation (unknown shapes → provisional/needsFix/requests, never a wrong map) — both bounded by design. The CI guard (`tests/guidelines.test.ts`) makes site-rule drift impossible.

## Problem instances (all one gap)

- the analytics SPA: two dashboards stayed separate provisional states — each face is dominated by its user-configured widgets, so page-level identity can't see the shared viewer template (Setup/Customize/Outline/date-range + per-widget controls).
- 'Expand drilldown' ×25 identical-name children survive folding (`foldRepeats` needs varying prefixes).
- OrangeHRM grid rows / automationexercise product cards: per-row/card repeated substructure is dropped as ambiguous instead of learned once.

## Mechanism (observational, zero-LLM)

1. **Bottom-up structural signatures** over the parsed snapshot: for each node, a signature = its role + the multiset of its children's signatures with NAMED LEAF TEXT ABSTRACTED (names on interactive controls kept — they're template labels like "Download chart as PNG"; free-text/heading leaf names abstracted to their role — they're candidate data slots). Pure tree fold; no meaning guessed.
2. **Fold repeated sibling subtrees:** ≥2 (tunable; ≥3 for weak signatures) siblings under one container with the SAME signature = instances of one sub-template. Emit ONE affordance group per signature: `{scope: 'widget', label: <the template's stable control labels>, count, paramSlots: [abstracted positions]}`. Subsumes: `foldRepeats` (a one-level subtree is exactly the named-sibling case), identical-name repeats (Expand drilldown ×25), and Task-15's `enumeratedNames` children fold.
3. **Widget types across observations:** signatures are comparable across pages/instances — the k distinct signatures observed for a site are its widget-type vocabulary (chart-widget, table-widget…). A new dashboard mixing known types is fully covered; an unknown signature = provisional repertoire addition (honest, marked).
4. **Face normalization for identity:** a page's dispose/cluster face replaces folded-instance tokens with their signature tokens (`widget:<sig>` ×k). Two dashboards then present the SAME face (viewer chrome + widget-type signatures) → template dispose merges them into one `dashboard-viewer` state. Which widgets a given dashboard shows = instance data read live at walk time (#6 line, one level deeper).

## Acceptance (same code, no site conditionals)

1. the analytics SPA dashboards 8001 + 8002 merge into ONE confirmed viewer state; per-widget controls appear once as widget-scoped repertoire; instance titles nowhere in fingerprint/labels.
2. OrangeHRM PIM grid rows fold to row templates including their per-row controls (not dropped as ambiguous).
3. automationexercise product cards on /products fold to one card template.
4. 'Expand drilldown' ×25 folds to one.
5. All existing suites green; `foldRepeats`/`enumeratedNames` call sites replaced by the general pass (delete, don't wrap).

## Risks

- Signature granularity is the design surface: too-fine (every widget unique) → no fold (today's behavior — safe); too-coarse → over-fold (mitigate: keep interactive-control names in the signature; they're the strongest template evidence). Start fine, loosen with evidence.
- Deeply nested repetition (widgets containing repeated rows) — the bottom-up fold handles it naturally (inner folds first), but tests must pin it.

## Shipped notes (2026-07-11)

Implemented per the plan (`2026-07-11-subtree-templates.md`, Tasks 1–4). Two deviations from this
design's original acceptance criteria, both deliberate and documented at the point of decision:

1. **`enumeratedNames` retained, not deleted — overlay-scoped.** The design said subtree folds would
   "subsume" it entirely. In practice a residual case survives: a flat value-domain split across
   ≥3 same-role/depth siblings under DIFFERENT heterogeneous per-category wrapper parents (subtree
   folds only group siblings sharing ONE parent). `enumeratedNames` stays as the narrow fallback for
   that case; a `ponytail:` comment at its definition (`src/explorer/draft.ts` ~135) names the follow-up
   that would finish the subsumption — a container-scope grouping pass matching a shared leaf signature
   across different parents within one container — as a future increment, not invented here.
2. **the analytics SPA dashboards 8001/8002 non-merge accepted as honest, not forced.** Acceptance item 1
   ("dashboards 8001 + 8002 merge into ONE confirmed viewer state") does NOT hold on the real recordings:
   8001 was captured with a chart's Setup/Customize config panel open on every landing, 8002 collapsed —
   a genuine recording-state conflict, so their widget signatures diverge (jaccard 0.094) independent of
   normalization correctness (proven via mutation check: stubbing normalization off changes nothing about
   the two dashboards). Per the project's fix-upstream rule, this was NOT force-merged or patched
   downstream; it surfaces as an open **Phase-1 research question — main-landmark identity scoping**:
   whether a page's identity face should treat "a landmark region (e.g. a config panel) is open" as its
   own structural axis, distinct from widget-shape, so that two recordings of the same page in different
   transient UI states still resolve to one template. Fix in the meantime is procedural (re-record 8001
   collapsed, or record both dashboards in the same UI state).
