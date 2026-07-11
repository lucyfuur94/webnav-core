# Extending webnav's structure inference — the pattern-pack loop

webnav's `graph-analyse --draft` infers page structure by OBSERVATION (settledness, ARIA
declaration, cross-page/cross-visit variance, within-page repetition — see
`2026-07-10-structure-inference-design.md`). It cannot see everything: a role-less div-soup
overlay, an unusual value-domain shape. When it can't resolve something it does NOT guess and it
does NOT get hand-patched — it reports the gap as a structured `unknowns[]` entry, and you (the
agent) close it with a **declarative pattern pack**: a JSON data file, never a code change.

**Packs are data, not code.** A pack's trigger schema is STRUCTURAL-ONLY (ARIA roles + containment
counts + attribute presence + an evaluation context) — it cannot name a hostname, a URL, or a UI
label. That's what keeps "fix this one site" impossible: every pack generalizes to any site with
the same *shape*. A pack can only make the engine MORE conservative about what it stores
(`overlay-open` / `value-domain`) — it can never mint an affordance, edge, or state.

## The loop, end to end

```
1. webnav dev graph-analyse --session <S> [--session <S2> …] --draft   > draft.json
   # read draft.json's "unknowns" array — each entry: {kind, evidence, context, extensionPoint}

2. webnav dev pattern-propose --from-unknown draft.json#<index> --name <slug>
   # scaffolds packs/patterns/proposed/<slug>.json — evidence embedded as the fixture,
   # trigger.contains left EMPTY (a TODO). Exits 0 (the SCAFFOLD succeeded); the printed
   # "lint.clean: false" is expected, not a bug — see step 3.

3. Fill in trigger.contains: >=1 { role, min?, attr? } predicate, derived from the evidence
   printed in step 2's output (or from packs/patterns/proposed/<slug>.json directly).
   Only ARIA roles (src/explorer/patterns.ts ARIA_ROLES) and ARIA attribute NAMES (ARIA_ATTRS)
   are legal values — a hostname/URL/label is a REJECTED lint reason, by design.

4. webnav dev pattern-propose --lint packs/patterns/proposed/<slug>.json
   # re-checks: schema shape + forbidden-value scan + runs your OWN fixture through the
   # real trigger evaluator. Iterate 3→4 until { "status": "done" }.

5. Re-run step 1's graph-analyse --draft on the SAME site. The unknown that named this gap
   should be GONE from the report (the pack now resolves it locally — proposed/ packs apply
   immediately, no build step, no restart).

6. Add ONE grammar fixture test (tests/grammar/*.test.ts — see pickers.test.ts's
   "X10 div-soup date-picker" block for the idiom) proving the resolved shape: the
   previously-undetected structure now classifies correctly, and (for value-domain) the
   values it excludes never become stored affordances/children/fingerprint tokens.

7. `npm test && npx tsc --noEmit` green, then run the command pattern-propose printed in
   step 2/4's checklist:
     gh pr create --title "pattern pack: <slug>" --body "...cites the evidence..."
   NEVER auto-run — you read it, you run it. The PR moves packs/patterns/proposed/<slug>.json
   to packs/patterns/core/ for upstream review, so every webnav install gets the fix.
```

## The honest boundary: when a gap ISN'T a pack

Some `unknowns[]` entries carry `"extensionPoint": "core-design"` instead of `overlay-open` /
`value-domain` (kinds: `ambiguous-cluster`, `unresolved-affordance`, `degenerate-landing`,
`pack-tripwire`). These are NOT expressible in the pack schema — no structural trigger fixes "this
page has no distinguishing heading" or "this affordance never resolves." Running
`pattern-propose --from-unknown` on one of these returns `{"status": "declined", ...}` and writes
NO file. That is the correct outcome, not a failure to route around:

- **Never** invent a third pack type, and **never** hand-patch `draft.ts`/`infer.ts` for a
  site-specific fix (the project's hard rule: fix upstream, generalize, never scrub downstream).
- **Do** file a core-design issue upstream, attaching the unknown's `evidence` + `context` verbatim
  as the reproducing fixture. A real core-design increment (a new inference axis, a new closed
  effect type) is a deliberate, reviewed change to the engine itself — out of scope for a pack.

## Reference

- Pack schema, lint, and the trigger evaluator: `src/explorer/patterns.ts` (read the file header —
  it documents the allow-lists and why each forbidden-value rejection exists).
- The `unknowns[]` report shape + sources: `src/explorer/draft.ts` (search `Unknown` / `evidenceOf`).
- `dev pattern-propose` implementation: `src/explorer/pattern-propose.ts` (pure; `cli.ts` just does
  the file read/write and prints the checklist).
- Worked example: `packs/patterns/core/date-picker-divsoup.json` (a real progneo div-soup date
  picker: a role-less grid of 28-31 same-shape `gridcell` day cells the core's own value-domain
  fold doesn't reach on every calendar shape) + `tests/grammar/pickers.test.ts`'s "X10" block.

> **Test authors:** under vitest, `defaultPackDirs()` returns `[]` — packs are INVISIBLE to tests unless injected explicitly (`draftFromEffects(effects, loadPatternPacks([CORE_PACKS_DIR]))`). This keeps ~90 engine tests decoupled from shipped packs; any test asserting pack behavior must inject.
