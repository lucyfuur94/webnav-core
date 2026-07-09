# Self-improving capture loop (Step 1 of the agent-recording roadmap)

**Date:** 2026-07-09
**Status:** approved, ready to build

## Goal

Make the recorder's capture *provably complete* before we trust a session enough
to fold it into the map. An agent explores a site, we audit the video against the
captured steps, surface where the recorder MISSED an action, fix those gaps, and
repeat until a clean audit — so the map is built from complete data, not
silently-lossy recordings.

## Honest framing (settled)

The recorder is **deterministic code, not a model** — it cannot rewrite its own
capture logic at runtime. So "self-improving" here means a **gap-finding harness**:
the loop automates explore → review → surface gaps and CONVERGES on a clean audit;
the actual recorder-code fixes for structural gaps are implemented by Claude/human
between rounds. The loop is fully automatic on the explore + review parts and
PAUSES with a gap report when code changes are needed.

## The loop

```
round:
  1. Agent (Haiku) explores the objective via `use session` (JSON-line channel) →
     records a session (steps + video + Agent origin).
  2. runSessionReview (Sonnet) audits video frames vs captured steps → STRUCTURED
     gap list.
  3. if gaps == 0  → DONE (capture complete for this objective).
     if gaps are PARAMETER-tunable (known knobs) → auto-tune + re-record (future;
       not in v1 — v1 treats all gaps as code fixes).
     else → PAUSE: present the gap report; Claude/human fixes the recorder code;
       human re-triggers the next round.
  stop also on: max rounds (default 5), or N=2 consecutive rounds with no NEW gap
     type (thrash guard).
```

**Re-record semantics (settled):** each round re-runs the SAME high-level
objective with a FRESH agent pass (not a scripted replay). It won't be identical
clicks, but it exercises the same UI surfaces, so a real gap recurs and the audit
confirms fixed-or-not. This tests fresh capture, which is what we care about.

**Convergence (settled):** stop when a round's structured review returns ZERO
capture-gaps (with the max-rounds + no-new-gap-type guards above).

**Drive + boundary (settled):** the harness spawns a Haiku agent (webnav cost
rule) to explore via `use session`; code fixes are Claude/human work between
rounds, not the loop editing the capture engine unsupervised.

## The one new capability: STRUCTURED review output

Review today returns free-text markdown; the loop needs a machine-readable gap
list to judge convergence. Add a **structured mode** to review:

- `buildReviewPrompt(..., { structured: true })` appends: "Return ONLY a JSON
  object: `{ gaps: [{ atMs, kind, whatHappened, shouldHaveCaptured }], verdict }`
  — gaps = visible changes with no captured step within ±5s. Empty gaps = complete."
- `runSessionReview` gains `structured?: boolean`; when set, it parses the JSON
  (tolerant: extract the first `{...}` block), returns `{ report, gaps }`, and
  writes both `review.md` (human) and `review.json` (the loop).
- The existing free-text review (dashboard button) is unchanged (default path).

## Components

- `src/recorder/review.ts` — structured mode (prompt + JSON parse + `gaps` in the
  return). Pure prompt/parse pieces unit-tested.
- `src/recorder/capture-loop.ts` (new) — `runCaptureLoop({ objective, site,
  profile, maxRounds, explore, review, log })` pure orchestrator: deps-injected
  `explore(round)` (drives one agent session, returns sessionId) and
  `review(sessionId)` (returns gaps), so it's unit-tested with fakes. Returns
  `{ rounds: [{ session, gaps }], status: 'clean' | 'needs-fix' | 'max-rounds' }`.
- CLI verb `dev capture-loop --objective "<text>" --url <U> [--profile p]
  [--max-rounds N]` — wires the real explore (spawn a Haiku agent driving
  `use session`) + real structured review, prints the per-round gap summary and
  the final status. On `needs-fix` it exits 3 with the gap report (the pause).
- The Haiku explorer is spawned via the Agent/Task tool by the CALLER (the loop
  provides the channel + prompt); webnav stays zero-LLM — the loop verb orchestrates
  processes, the reasoning is the spawned agent's.

## Testing

- review structured: prompt contains the JSON instruction; parse handles clean
  JSON, JSON-in-prose, and garbage (→ empty gaps + a parse note). Unit.
- capture-loop: fake explore/review — converges (gaps→0 stops), hits max-rounds,
  and no-new-gap-type thrash guard fires. Pure unit, no browser.
- e2e (saucedemo, headless): one real round — agent explores via `use session`,
  structured review runs, a gap list (possibly empty) comes back; assert the loop
  produces a round record with a session that has steps + video.
- Live: run the loop on saucedemo; confirm the gap report is actionable.

## Out of scope (later steps)

- Auto-tuning recorder PARAMETERS from gaps (v1 = all gaps are code fixes).
- Autonomous code-fixing agent (v1 pauses for Claude/human fixes).
- Step 2 (analyse→draft for agent sessions) and Step 3 (replay) — already exist;
  wiring them agent→map→replay end-to-end is a SEPARATE next increment.
- Video→map documentation (the separate high-value idea) — its own spec.

## Guardrails

- Headless; one window at a time; `use session` closes its own browser per round
  (no leak). Haiku for the explorer (cost rule). NEVER touches the user's real
  Chrome (webnav-profile-path match only).
