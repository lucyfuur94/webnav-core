# Walk-driven release suite — implementation report (2026-07-12)

Deliverable #18: `webnav test --suite <file>` + the progneo v1 suite. Consumer product
surface dogfooding the automation-testing use case. Design locked in
`docs/superpowers/specs/2026-07-12-release-suite-design.md`.

## Design decisions

- **Runner reuses `walkRoute` programmatically** (not the CLI). `src/router/suite.ts`
  imports `walkRoute` + `findPath` directly, exactly like the `walk` CLI handler does.
  Checkpoints are auto-asserted then resumed via the same `{kind:'continue'}` answer the
  `walk-resume --continue` path uses — zero duplicated walk logic.
- **Dependency injection for testability.** `runSuite(suite, deps)` takes a `SuiteDeps`
  with `store`, `states`, `openCase(startUrl) -> {browser, close}`, and an optional
  `preflight()`. Unit tests inject a scripted `WalkBrowser` (same fake shape as
  `walk.test.ts`); the CLI injects the live `PlaywrightAdapter` + `makeLiveWalkBrowser`.
  No live browser in any unit test.
- **Zero-answer rule is structural.** The runner answers NOTHING. A `needs-navigation`
  (drift) or `needs-classification` (commit point) charges an interaction against
  `maxInteractions` (default 0) and FAILS the case with the pause payload as diagnostics.
  It never classifies safe, so commit points always fail — a release check never places an
  order. The Admin / Switch-to-Classic exclusion is satisfied *by construction*: the runner
  only follows mapped autopilot navigation and never clicks anything it wasn't routed to.
- **`start == goal` observe case (progneo case 1 & the builder-URL case).** `walkRoute`
  halts at the goal immediately and returns `done` (never a `checkpoint` pause), attaching
  the goal's stored repertoire + live snapshot to `evidence` via its goal-state enrichment.
  So the runner asserts the goal checkpoint against the `done` evidence with the *same*
  `assertCheckpoint` machinery. The repertoire asserted is the STORED one (the stability
  contract), matching the design.
- **Auth pre-flight ONCE before case 1**, reusing the exact `dev profile-status` engine
  (`classifyAuthLanding` over a settled headless load of the site's map `homeUrl`).
  `needs-login` fails the WHOLE run fast with the login hint (every case marked
  `failure.at = "preflight"`), rather than 7 wall failures. `unknown`/`valid` proceed.
- **Serial, fresh headless session per case, reaped between.** `openCase` opens a new
  `PlaywrightAdapter` (short id, `ensureCanOpen` gate), and `close` reaps it in the case's
  `finally`. The runner forces `headed:false` regardless of flags — a release check must
  never pop windows (CLAUDE.md rule). Per-host politeness throttle is respected because it
  lives in the adapter's open/goto layer (unchanged path).
- **Suite is DATA.** `packs/suites/progneo.suite.json`. No site name appears in `src/`
  (guidelines.test.ts enforces this — I genericized every comment/example that tripped it).
- **Output/exit codes.** `{status:'ok'|'failed', passed, failed, cases:[{name, verdict,
  elapsedMs, failure?:{at, payload}}]}`; exit 0 all-pass · 3 any-fail · 2 bad suite/config.
  Progress → stderr. Self-describing `--help` teaches the format + the zero-answer philosophy.

### Deviation from the spec's case list (map is ground truth)

The spec sketched case 4 as "downloads list + Owned/Shared tabs present". The actual stored
`download-list` repertoire has NO "Owned/Shared" (that label lives on `report-list`). Per the
instruction "if cases fail for MAP reasons, fix the SUITE file (it's data)", case 4 asserts
what `download-list` actually declares: `repertoireContains: ["Search", "Refresh list"]`.
All other cases match the spec. Case 2 uses the report builder's addressable URL as `start`
(== `goal`) per the v1 zero-answer purity decision — a URL-reachability check, no checkpoint.

## Files

- `src/router/suite.ts` — parser (`parseSuite` → `SuiteConfigError` on bad input), the
  runner (`runSuite`/`runCase`), checkpoint assertion, `SuiteDeps`.
- `src/cli.ts` — `test` verb: parse + handler (loads/validates the suite, builds live
  `SuiteDeps`, prints the verdict JSON, sets exit code).
- `src/cli-spec.ts` — `test` command in the consumer section (self-describing help).
- `packs/suites/progneo.suite.json` — the 7-case worked example.
- `tests/router/suite.test.ts` — 13 tests (below).
- `tests/cli-spec.test.ts` — added `test` to the registered-verbs list.

## Tests (TDD)

`tests/router/suite.test.ts` — 13 assertions, no live browser:
- parseSuite: accepts well-formed; rejects non-object / missing site / empty cases /
  missing start / missing goal / negative maxInteractions (→ SuiteConfigError → exit 2).
- runSuite: pure-autopilot pass; checkpoint repertoire pass; checkpoint assertion fail;
  gated step → needs-navigation beyond budget → fail with pause payload; commit point →
  needs-classification → fail (never classified safe); auth pre-flight needs-login →
  whole-run fail-fast; mixed serial pass/fail + unknown-state resolve fail.

`npm test`: **880 passed, 7 skipped, 0 failed** (99 files). `npx tsc --noEmit`: **0 errors**.

## LIVE run — `npx tsx src/cli.ts test --suite packs/suites/progneo.suite.json --headless`

Pre-flight (stderr): `pre-flight ok: auth=unknown` (landed on the right host; no SSO wall —
profile `default` is logged in enough to reach the pages; a wall would have failed matchState
→ needs-navigation → case fail). Ran headless — no windows popped. Sessions reaped after
(one dead-browser orphan cleaned by `dev sessions reap`).

Verdict JSON (verbatim):

```json
{
  "status": "ok",
  "passed": 7,
  "failed": 0,
  "cases": [
    { "name": "reports list reachable and functional", "verdict": "pass", "elapsedMs": 3006 },
    { "name": "report builder reachable via its addressable URL", "verdict": "pass", "elapsedMs": 2916 },
    { "name": "dashboards list reachable with New Dashboard", "verdict": "pass", "elapsedMs": 5979 },
    { "name": "downloads list reachable and functional", "verdict": "pass", "elapsedMs": 5239 },
    { "name": "help center reachable", "verdict": "pass", "elapsedMs": 5733 },
    { "name": "announcements reachable", "verdict": "pass", "elapsedMs": 5353 },
    { "name": "shell navigation: report-list to dashboard-list (from-anywhere edge)", "verdict": "pass", "elapsedMs": 5142 }
  ]
}
```
Exit code: 0.

### Assertions are load-bearing (negative check)

A one-off suite with a deliberately-wrong `repertoireContains: ["ThisLabelDoesNotExist"]`
against the live `report-list` FAILED (status: failed, exit 3), reporting the real
repertoire as diagnostics — confirming the passing cases assert against genuine stored data,
not vacuously:

```
"payload": "repertoire missing \"ThisLabelDoesNotExist\" (have: report-list, Open sidebar,
Close sidebar, ..., Search, Refresh list, Owned/Shared, Favourites, Standard, ..., New Report,
OS and Device Report, Page)"
```

("Search", "New Report", "Owned/Shared" — the labels the passing cases assert — are all in
the live `have:` list.)

## Per-case outcomes

| # | case | route | assertion | result |
|---|------|-------|-----------|--------|
| 1 | reports list reachable + functional | report-list (start==goal) | repertoire has Search, New Report, Owned/Shared; New Report is mutate | pass |
| 2 | report builder reachable via URL | report (start==goal, addressable) | done | pass |
| 3 | dashboards list + New Dashboard | report-list → dashboard-list (shell edge) | repertoire has Search, New Dashboard; New Dashboard is mutate | pass |
| 4 | downloads list reachable + functional | report-list → download-list (shell edge) | repertoire has Search, Refresh list | pass |
| 5 | help center reachable | report-list → help-center (shell edge) | repertoire has "Search help..." | pass |
| 6 | announcements reachable | report-list → announcements (shell edge) | done | pass |
| 7 | shell navigation from-anywhere | report-list → dashboard-list | done | pass |

## Concerns

None blocking. Two honest notes:
- Pre-flight returned `auth=unknown` (not `valid`) because progneo's `homeUrl`
  (`https://progneo.analytics.mn`) redirects to a landing that isn't one of the mapped
  fingerprinted states. This is correct behavior (unknown proceeds; only needs-login fails
  fast). If a stricter "must be logged in" gate is wanted, the map would need a fingerprint
  on the post-login landing — a MAP/data change, not an engine one.
- Cases 3 and 7 walk the same route (report-list → dashboard-list); case 3 adds a repertoire
  checkpoint, case 7 is the bare from-anywhere-edge assertion the spec named explicitly. Kept
  both as the spec lists 7 distinct cases; case 7 could later re-point at a different shell
  destination if a purer distinct-edge demonstrator is wanted.
