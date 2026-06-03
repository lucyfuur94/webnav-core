# Navigation benchmark (R2) — multi-page tasks, quality + reliability — design

**Date:** 2026-06-03 · **Status:** approved (brainstorm), pending spec review

## Why

Every benchmark so far (R1, R1.1) used **single-page lookups** — the answer sits on
one fetchable URL, so webnav, plain search, and raw-browser all tie (R1.1 A-vs-C:
tied 10/10). That can't test webnav's actual thesis (CLAUDE.md criterion #2 /
success criterion #1): *a navigation skeleton that reaches signals reliably beats
an agent ad-hoc-driving a heavy site UI.* That edge only appears on **multi-page
navigation** — search → pick a result → drill into its detail page (a
non-addressable state reached by traversal, not a known URL).

This increment adds a **multi-page task set** and runs it through the existing
3-arm harness, scoring **quality + reliability + tool-call count** — the A-vs-C cut
single-page tasks structurally could not show.

## Decisions (settled in brainstorm)

- **Task shape: `search → pick result → drill into detail`.** Each task forces a
  GitHub search-results page → choose a candidate → navigate to its detail page →
  read declared signals. webnav's `recall` does exactly this skeleton in one verb;
  the raw-browser arm must drive GitHub's search UI itself. The cleanest A-vs-C
  navigation contrast.
- **3 arms, unchanged, all Sonnet:** A = webnav CLI, B = WebSearch + WebFetch,
  C = raw `playwright-cli` (no webnav map). Anonymized 3-way judge, order varied.
- **Do NOT build a new token-measurement mechanism.** Use `subagent_tokens` from
  the Task result as-is — BUT it is ~18.6k spawn-floor-dominated (measured), so it
  cannot prove clean token savings. The primary cost metric is **`tool_uses` count**
  (also from the Task result, floor-free): "how many actions to reach the answer."
  Tokens are reported with the explicit floor caveat. The transcript-bytes metric
  remains explicit future work (not built here).
- **Score quality + reliability.** Quality = correct/partial/wrong via the judge.
  Reliability = a tag the ORCHESTRATOR assigns from each arm's tool-call trace
  (clean / recovered / lost) — the judge does NOT see it (judge stays focused on
  answer quality only).
- **Gold answers are rubrics** (live values + the agent's repo choice vary): correct
  = reached a plausible top-result repo for the query AND reported the asked signals
  with evidence of a live fetch; any defensible top result is accepted (we score
  navigation + accurate reporting, not repo taste).
- **GitHub-navigation-focused; bot-walled cases excluded** (all arms can reach
  GitHub; the honest-failure boundary was already covered in R1.1).

## Arms (unchanged R1.1 harness)

- **A — webnav:** `recall <goal-id> "<query>"` runs search→results→detail and returns
  an evidence bundle; the agent ranks. (Also has `read`/`eval` if it wants them.)
- **B — baseline:** Claude WebSearch + WebFetch only.
- **C — raw browser:** `playwright-cli` only (open/snapshot/click/...); the agent
  navigates GitHub's UI itself.

Verbatim arm prompts reused from `bench/README.md` (R1.1), with the task prompt
substituted. Same anonymized 3-way judge prompt.

## Task set (`bench/tasks-nav.yml`, ~8 tasks, category `github-nav`)

All `search → pick → drill-in`:
1. `nav-rust-web` — Rust web framework: most-starred result's name, license, latest release tag.
2. `nav-py-cli` — Python CLI-arg parsing library: top result's open-issue count + last-commit recency.
3. `nav-go-orm` — Go ORM: top repo's name, current stars, recent-commit activity.
4. `nav-js-test` — JavaScript testing framework: top result's name, license, latest release.
5. `nav-py-http` — Python HTTP client: top result's stars + open issues.
6. `nav-rust-cli` — Rust CLI-building library: top repo's name, stars, last-commit recency.
7. `nav-data-viz` — Python data-visualization library: top result's name, license, star count.
8. `nav-k8s-tool` — Kubernetes CLI tool: top repo's name + latest release tag.

Each `gold_answer` is a rubric: *correct* = a defensible top repo for the query +
the asked signals reported with live-fetch evidence (specific values); *partial* =
right repo but a signal missing/unsourced, or answered from the results page
without drilling into detail; *wrong* = wrong/fabricated repo or no signals. The
rubric explicitly accepts any reasonable top result (e.g. Rust web framework →
actix-web / axum / rocket all fine).

## What we score

- **Quality** — anonymized judge → correct/partial/wrong per arm.
- **Reliability** (orchestrator-assigned from each arm's tool-call trace):
  - `clean` — reached the detail page and answered directly.
  - `recovered` — hit a wrong turn / empty snapshot / render race but recovered.
  - `lost` — thrashed, gave up, or answered from the results page without drilling in.
  Thesis prediction: webnav mostly `clean`; raw-browser shows more `recovered`/`lost`.
  If C is as clean as A, that's honest evidence the skeleton adds less than hoped.
- **Cost: `tool_uses` count** per arm (primary, floor-free) + `subagent_tokens`
  (secondary, with the ~18.6k-floor caveat).

## Data flow (per task, ×8)

```
dispatch A (webnav), B (baseline), C (raw browser) concurrently, all sonnet
  → each Task result gives { final answer, tool_uses, subagent_tokens }
orchestrator tags each arm's reliability from its tool-call trace
judge(gold rubric, anonymized[A,B,C] randomized order) → 3 quality verdicts
record row → aggregate → bench/results/<date>-nav.md
```
Arm A and Arm C both drive playwright-cli → distinct `-s=` sessions per task.

## Report (`bench/results/<date>-nav.md`)

- Headline: quality tally (A/B/C correct) + reliability tally (clean/recovered/lost
  per arm) + median `tool_uses` per arm.
- **A-vs-C cut:** does webnav's skeleton complete search→drill-in more cleanly and
  in fewer tool calls than ad-hoc browsing? (The thesis question.)
- Per-task table: per arm — verdict, reliability tag, tool_uses, tokens.
- Caveats: one sample; judge fallibility; tokens floor-dominated (tool_uses is the
  real cost signal); rubric accepts any defensible top result; reliability tag is
  orchestrator judgment from the trace.

## Code impact (small)

- `bench/load.ts`: add `'github-nav'` to `ALLOWED_CATEGORIES`.
- `tests/bench/load.test.ts`: update fixtures to include/accept `github-nav`.
- `bench/tasks-nav.yml`: the new task set (the loader can load either file by path;
  `loadTasks('bench/tasks-nav.yml')`).
- `bench/README.md`: note the nav task set + the reliability/tool_uses scoring.
- Orchestration (the live run): done by the main agent. No new src/ code; webnav
  unchanged.

## Testing

- TDD the `ALLOWED_CATEGORIES` addition + its test (loader logic unchanged).
- Validate `bench/tasks-nav.yml` loads (8 tasks, all `github-nav`, unique ids).
- The experiment is validated by RUNNING it: smoke 1–2 tasks across all 3 arms
  (confirm a 3-way scored row + reliability tag + tool_uses), then the full ~8.

## Out of scope (designed-for, not built)
- Transcript-bytes token metric (the clean cost measure) — still future work.
- Filtered/sorted-view tasks and cross-site hop tasks (other multi-page styles) —
  this set is search→drill-in only.
- A second non-GitHub site (genericity) — separate increment.

## Success criteria
1. A committed multi-page `search→drill-in` task set + a live results report.
2. The report answers the A-vs-C thesis question with quality + reliability +
   tool_uses: does webnav's navigation skeleton beat an agent ad-hoc-driving the
   browser on multi-page navigation? — honestly, including if it doesn't.
