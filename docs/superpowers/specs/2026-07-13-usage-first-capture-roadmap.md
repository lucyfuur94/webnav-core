# Usage-first mapping + capture fidelity — roadmap (2026-07-13)

> **Session-handoff doc.** Start here in a new session. Written after a strategy discussion with the user (2026-07-12/13); the decisions below are agreed direction. Current engine/map state: see `docs/STATUS.md` top entries. Settled rules: `CLAUDE.md` (fix-upstream HARD RULE, structure-inference axes, subagent model division).

## Where we are (one paragraph)

The structure-inference engine is shipped and validated (observation-based, zero site rules, guard-tested; 903 unit+grammar tests green). The the analytics SPA map is account-portable (tenant id → `{param}`; cross-account variance strips instance data automatically — proven live with two accounts), the `dev frontier` verb makes exploration coverage measurable, the release suite (`webnav test --suite packs/suites/the analytics SPA.suite.json`) runs 7/7 live, the extension loop (pattern packs + unknowns + `pattern-propose`) is live, and the walk has checkpoints (`--observe`) and `needs-auth` handling. Deliverables shipped: verification report, Remotion walkthrough v2 (+ `walkthrough/CONTENT.md` standing brief), navigation-map artifact.

## The strategy (agreed with the user)

### 1. What the product is — the sweet-spot line
webnav is a **navigation memory**, not a site clone. Map to the granularity of **navigation, not interaction**:
- ALWAYS store: the reachability graph (states + edges), commit-bearing funnels (mapped from declarations, never fired), and each page's **capabilities** (has-a-dimension-picker, can-export) as structure.
- NEVER store: interior data values, free-form authoring interiors' contents (a builder is a *destination*, not a corridor — what you do inside it is live, judgment work for the calling agent).
- OPEN QUESTION (user hasn't ruled): capabilities-not-values for deep interiors ("knows the builder HAS a dimension picker") vs navigation-only depth. Current engine behavior ≈ capabilities-not-values; keep unless the user says trim deeper.

### 2. Usage-first mapping (the Google Maps model — three layers)
The user's thesis, agreed: maps should come primarily from **real usage**, not agent exploration.
- **Base layer**: what the site declares (current inference) — cheap, value-blind.
- **Usage layer (primary)**: real sessions are the "pings". Value-weighted (hot routes get mapped best), fresh (first real session after a redesign detects drift), self-confirming (every real visit answers a confirm-visit ask). Agents first (already instrumented); humans later (needs the privacy unlock below).
- **Exploration layer (demoted to gap-filler)**: frontier-driven passes only where usage never goes; commit funnels inferred, never fired.

### 3. Fidelity before volume (the user's key concern — verbatim spirit)
"No matter how much we record, manually or silently, if we don't capture properly we end up in the same spot." Correct: **volume never fixes sensor blindness**. Three failure classes:
1. Capture is BLIND to it (unnamed icon controls, hover-only menus, drag-and-drop, 800px video cap) → needs sensor upgrades; recording more just industrializes the blind spots.
2. Capture degrades it (pre-settle snapshots) → mostly fixed.
3. Capture fine, inference misread (data-value leaks, tenant keying) → fixed; volume/variance genuinely helps here.
**Order of work: fix the camera, then record everything.**

## Build queue (priority order)

1. **Capture-fidelity program** (sensor upgrades; capture-engine = GATED, describe+risk then wait for user OK per standing rule):
   a. Landing name-probe: extend the existing NAME_PROBE_JS (currently clicked-elements-only) to landing snapshots so icon-only controls get names (fixes the 0-affordance dashboard class, X6).
   b. Hover-probe pass (opt-in during record): capture hover-revealed menus (matrix X2); right-click/context menus.
   c. **Fidelity audit**: extend the existing video-vs-steps review to video-vs-STRUCTURE ("video shows 6 widgets; snapshot has 6 nameless divs" = measured fidelity gap per session). This makes blind spots measurable instead of discovered by accident (the model-switcher lesson).
   d. Known ceiling (accept/park): playwright-cli video 800px cap; drag-and-drop needs a drag primitive (X13).
2. **Ambient agent-session capture** (the volume multiplier — AFTER 1a/1c): every `use`/MCP agent session auto-buffers as a lightweight recording (no record-start ceremony), size caps + auto-fold cadence + boring-trace discard; on-by-default with opt-out. The merge/variance pipeline already handles messy sessions.
3. **Remaining map-quality loops** (user chose "keep driving to clean" before the strategy pivot; now lower priority than 1-2): merge new-report draft render-phases (report-draft-time/-table = one builder); list-item-link fold (the 'Demo User'/'Sales Dashboard' per-row navigate labels — known gap, reviewer-confirmed pre-existing); lone-opaque-instance heading fingerprints; help-center/faq split.
4. **Phase 3 sweep** (task #13): 15-25 stratified sites through the extension loop + the **escalation-rate curve** measurement (walk 1 vs 5 vs 20 — the amortization thesis gets settled by numbers; user explicitly asked for honesty here).
5. **Human skeleton-capture** (privacy unlock): reduce human-session capture to structural skeleton at source (roles+controls, content dropped pre-storage) → "contribute while you work" opt-in. The old Chrome extension may return as a COARSE ping source only (URL transitions + clicked control), never full capture.
6. **Hosted aggregation** (webnav-site repo, per settled 2026-06-12 decision): cross-user map aggregation + usage weights = the Waze flywheel. Not in this repo.

## Standing constraints (do not re-learn these)
- the analytics SPA: NEVER click Admin / Switch to Classic. Headless only; one browser at a time; reap after; CF pattern = first-load-per-session passes.
- Fix upstream, never patch downstream; RCA before fixing; the user checks for this explicitly.
- Explore by `dev frontier`, never by intuition (a hand-picked list missed the sidebar model switcher).
- The map stores structure, never data values — enforced by tests/guidelines.test.ts + acceptance kind-locks.
- Division of labor: Fable defines/reviews; Opus/Sonnet implement; Haiku drives webnav in tests. Subagent-driven dev with per-task review + fix loops; worktree per increment; commit author dikshant.y.
- User wants brief, plain-English communication; technical identifiers never in user-facing surfaces.

## Verify-current-state commands
`npm test` (903/7 expected) · `npx tsx src/cli.ts dev frontier --node app.example.com` (coverage worklist) · `npx tsx src/cli.ts test --suite packs/suites/the analytics SPA.suite.json --headless` (release suite 7/7) · `npx tsx src/cli.ts dev graph-show --node app.example.com` (12-state account-portable map) · artifact: https://claude.ai/code/artifact/323e70b5-49a8-4818-a5d7-109f3b3bd202
