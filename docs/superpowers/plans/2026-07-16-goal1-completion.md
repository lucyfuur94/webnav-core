# Goal-1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, task-by-task with per-task review.

**Goal:** Close X4/X5/X7/X8/X9 + X6-human, then prove capture completeness with real progneo recordings.

**Spec:** `docs/superpowers/specs/2026-07-16-goal1-completion-design.md` — READ FIRST; it fixes every decision. The matrix (`2026-07-12-structure-coverage-matrix.md`) rows carry per-gap detail.

## Global Constraints

- Zero LLM in webnav; observed evidence only; commit points never fired; the map stores structure never data values (`tests/guidelines.test.ts` green ALWAYS); fix upstream never downstream.
- The three real-corpora acceptance tests (`tests/acceptance/`) are the regression bar for every inference change (X4/X5/X8): they must stay green with ZERO unexplained identity/affordance changes; any delta is reported and justified in the task report.
- 2-space, single quotes; TDD; focused suites while iterating, full `npm test` once per task; commit per task (author dikshant.y).
- progneo (Task 7 only): NEVER click Admin or Switch-to-Classic; headless; one browser; serial; reap after; real db is review-gated — no graph merge without passed review.

---

### Task 1: X9 — upload primitive
**Files:** `src/playwright/adapter.ts` (+`upload(file)`), `src/recorder/agent-session.ts` (`upload` command per spec: effect `action:{upload:true, name:<basename>}` + ledger event; never store the full local path), tests (`tests/playwright/adapter.test.ts`, `tests/recorder/agent-session.test.ts`).
**Interfaces:** `adapter.upload(file: string)` → `exec('upload', file)`; AgentSessionCmd gains `{cmd:'upload', file}`; ActionRef gains `upload?: boolean`.
Verify playwright-cli's upload semantics from its --help (targets the chooser opened by the last click) and document in a comment. Commit `feat(use): file-upload primitive + recorded upload evidence (X9)`.

### Task 2: X4 — alias reproduction gating
**Files:** `src/explorer/draft.ts` (alias map block ~523-532), `src/explorer/infer.ts` if the receipt/requests plumbing lives there; grammar test file for aliases (find existing alias tests by grep).
**Behavior (spec):** ≥2 same-pair observations → alias; single observation → no alias + receipt.requests entry; contradiction (1 requested key → ≥2 settled keys) → needsFix naming both, never silent; foreign-host guard unchanged.
**Tests:** synthetic: single-shot alias NOT formed + request emitted; repeated pair formed; contradiction → needsFix; acceptance suite green (progneo aliases repeat across its sessions — verify and state the count in the report). Commit `fix(draft): aliases require reproduction; guarded redirects surface as needsFix (X4)`.

### Task 3: X7 — structural settledness
**Files:** new pure `structuralSignature` (put beside `classifyReadiness` in `src/router/readiness.ts`), `src/router/browse.ts` `settleSnapshot` (signature-equality settle condition between retries), tests (`tests/router/`).
**Behavior (spec):** signature = role skeleton + interactive-node names, EXCLUDING subtrees under log/status/marquee/timer/alert; consecutive samples equal-by-signature ⇒ settled even if raw text differs; genuinely churning interactive structure still unsettled. classifyReadiness untouched.
**Tests:** ticking-feed fixture settles; interactive churn does not; live-region subtree exclusion pinned; settleSnapshot uses ≤ the same retry budget. Commit `feat(readiness): structural settledness — live regions never block settle (X7)`.

### Task 4: X8 — baseline-presence precedence
**Files:** `src/explorer/draft.ts` (transient/overlay set construction ~1055/1200), grammar test (`tests/grammar/` — beside overlays tests).
**Behavior (spec):** overlay-role subtree present in the settled BASELINE face ⇒ shell/page structure, never transient overlay nor value-selection fold; click-revealed instance of the same roles stays overlay.
**Tests:** persistent AntD-style role=menu sidebar → nav affordances (not overlay children); post-click menu → overlay (existing behavior pinned); acceptance green. Commit `fix(draft): baseline overlay roles are page structure, never transient (X8)`.

### Task 5: X5 — container-scoped folding
**Files:** `src/explorer/infer.ts` (`subtreeFolds` container-scope grouping pass), `src/explorer/draft.ts` (`enumeratedNames` narrows/deletes per its ponytail comment), grammar tests.
**Behavior (spec):** ≥3 same-role/depth leaf siblings across heterogeneous wrappers WITHIN one owning container fold to that container's value domain; zero per-value affordances leak.
**Tests:** tags-in-trigger fixture; day-grid-in-dialog fixture; whatever enumeratedNames still covers keeps a test or is deleted with justification; acceptance green. Commit `feat(infer): container-scoped value-domain folding (X5)`.

### Task 6: X6-human — idle-tick probe
**Files:** `src/recorder/live-record.ts` (idle-tick budget ≤3 refs, abort on any drained event, cap 16/landing, `WEBNAV_NO_IDLE_PROBE=1` opt-out), `src/mapstore/record.ts` (`mergeNameHints(session, seq, hints)` upsert), tests (`tests/recorder/live-record.test.ts`, `tests/mapstore/`).
**Behavior (spec):** probe ONLY when a tick drained zero events and no pendings; resume across idle ticks; hints merge onto the landing's most recent stored effect; human latency always wins.
**Tests:** scripted loop — busy ticks never probe; idle ticks probe ≤3 and accumulate; event arrival aborts mid-budget; merge round-trip; env opt-out. Commit `feat(recorder): idle-tick name-probe closes X6 on the human path`.

### Task 7: Local-fixture E2E (all six changes together)
Headless, scratch `WEBNAV_DB`, local http.server fixtures ONLY (upload form; ticking live-region page; persistent-menu page; tag-picker + day-grid dialog; SVG icon page for idle-probe via a `record-live`-style loop if drivable headless — else assert via unit seams and say so). Evidence per check: command + observed output + SQL. Full `npm test` + tsc. Reap everything.

### Task 8: Progneo validation (the goal-1 proof)
Per spec section: frontier worklist → fresh recordings (serial, headless, profile auth, CF first-load pattern, NEVER Admin/Switch-to-Classic) with hover-probe/right-click passes → `dev review` per session (structured) → draft unknowns → verdict with evidence: LANDING STRUCTURE ≈0 nameless on key pages, review gaps 0 (or each explained), unknowns each explained, ledger drops enumerated, frontier delta reported. ANYTHING still missed is reported as the next increment — never hidden. No graph-edit merges without passed reviews. Cleanup: reap; no leaked browsers; recordings stay (they are real usage data).
