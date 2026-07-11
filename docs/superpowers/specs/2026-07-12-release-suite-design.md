# Walk-driven release suite (design, 2026-07-12 — approved deliverable #18)

**Purpose:** "check everything is good before releases" as ONE command. Test cases are declarative walk specs; the walk engine executes them; checkpoints (`--observe`) are the assertion hook. Dogfoods webnav's advertised automation-testing use case on progneo.

## Suite format (`*.suite.json`)

```json
{ "site": "progneo.analytics.mn", "profile": "default",
  "cases": [
    { "name": "reports list reachable and functional",
      "start": "report-list", "goal": "report-list",
      "observe": ["report-list"],
      "expect": {
        "status": "done",
        "maxInteractions": 0,
        "checkpoint": { "report-list": { "repertoireContains": ["Search", "New Report"], "kinds": { "New Report": "mutate" } } }
      } },
    { "name": "report builder reachable from list",
      "start": "report-list", "goal": "report",
      "expect": { "status": "done", "maxInteractions": 1 } }
  ] }
```

- `expect.status`: the terminal status the case demands (`done`; a wall test may expect `needs-auth`).
- `maxInteractions`: how many `needs-*` escalations the runner may answer... it answers NONE — v1 rule: any `needs-navigation`/`needs-classification` counts as an interaction; if the count would exceed `maxInteractions`, the case FAILS with the pause payload as diagnostics. `maxInteractions: 0` = pure autopilot. (Escalations are the walk asking for judgment; a release check has no judge — a case needing judgment beyond its budget is a regression signal or a bad case.) Checkpoints do NOT count (the runner auto-asserts and `--continue`s).
- `checkpoint.<state>`: assertions against the checkpoint payload — `repertoireContains` (labels present in the state's stored repertoire), `kinds` (label → expected kind), `snapshotContains` (optional live-page substring, use sparingly — live data churns).
- Forbidden by construction: the runner never fires classify-safe (commit points always fail a case — a release check must never place orders).

## Runner: `webnav test --suite <file> [--headless]`

- Serial execution, ONE browser session per case (fresh session each — the CF first-load pattern), reap between cases, per-host politeness respected.
- Output: single JSON `{status: 'ok'|'failed', passed, failed, cases: [{name, verdict, elapsedMs, failure?: {at, payload}}]}`; exit 0 all-pass, 3 any-fail, 2 config error. stderr = progress lines.
- Auth pre-flight: `profile-status` check on the site before case 1; `needs-login` → the whole run fails fast with the login hint (exit 3, one clear message) rather than 10 wall failures.
- Lives as a consumer verb (`test`, peer of `walk`) — this is product surface, self-describing help per cli conventions.

## Progneo v1 suite (`packs/suites/progneo.suite.json` — data, ships as the worked example)

Cases: (1) reports list autopilot + repertoire; (2) list → report builder (≤1 interaction — the row pick is a designed judgment; budget 1 with a first-row auto-answer? NO — v1 keeps zero-answer purity: this case uses the builder's addressable URL as start instead); (3) dashboards list autopilot + New Dashboard present; (4) downloads list + Owned/Shared tabs present; (5) help-center reachable; (6) announcements reachable; (7) shell navigation: start report-list → goal dashboard-list (exercises a from-anywhere shell edge, maxInteractions 0).

## Non-goals (v1)

No parallel cases (browser guardrails), no scheduling/CI wiring (one command; CI can call it), no auto-answering of escalations, no screenshot diffing (the checkpoint repertoire IS the stability assertion; pixels churn).
