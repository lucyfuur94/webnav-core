# R1 — A/B Benchmark (agent + webnav vs. agent + plain search) — design

**Date:** 2026-06-02 · **Status:** approved (brainstorm), pending spec review

## Problem / goal

webnav's thesis (CLAUDE.md success criterion #2): **the saving is the calling
AGENT's LLM tokens + wall-clock** — without webnav, an agent burns tokens every
query reading huge page snapshots and reasoning step-by-step about what to click;
webnav does that navigation deterministically (zero LLM) and hands back a compact
evidence bundle. R1 turns that claim into **evidence**: a head-to-head benchmark
of *agent + webnav* vs *agent + plain web search* on real info-seeking /
navigation tasks, scoring **answer correctness + agent tokens**.

This is an **executable benchmark experiment**, not a library feature. The
deliverables are committed artifacts (task set, gold answers, rubric, arm
prompts) plus a **results report**. Runs are real, live Claude subagents
dispatched via the Task tool, so the output is genuine evidence; re-running
reproduces it modulo run-to-run variance (reported honestly).

## Decisions (settled in brainstorm)

- **Real subagents via the Task tool**, all on the **Sonnet** model (the three
  roles below). Measures true agent tokens + real answers.
- **Broad MIXED task set** (~10–12 tasks): includes tasks webnav does NOT cover
  well (pure answer-synthesis, bot-walled sites) alongside its strengths. A
  benchmark that only includes webnav-wins is marketing, not evidence — the
  honest spread is what makes the wins credible and shows WHERE the edge is.
- **Baseline arm = Claude's own WebSearch + WebFetch** (the realistic "agent
  today"); **webnav arm = the webnav CLI only** (no WebSearch/WebFetch). The
  honest real-world comparison.
- **LLM judge + gold answers**, anonymized arms, citing evidence. The judge is a
  BENCHMARK tool only — webnav itself stays zero-LLM (principle #5a).
- **Same model (Sonnet) for both arms** — isolates the measured variable to
  TOOLSET, not model capability. Judge on Sonnet too (consistent, cost-effective).
- **Orchestrated by the main agent** this session (no standalone runner script /
  Agent-SDK dependency): the harness is an orchestration recipe + committed
  artifacts. Re-runnable by following the recipe.

## Architecture — three subagent roles (all Sonnet, via Task tool)

1. **Arm A — webnav agent.** Given ONLY the webnav CLI (discovers it via
   `webnav --help`, then uses `recall`/`search`/`route`/`hop`/`locate`). No
   WebSearch/WebFetch. Answers the task; returns its answer text.
2. **Arm B — baseline agent.** Given ONLY Claude's WebSearch + WebFetch. Same
   task; returns its answer text.
3. **Judge.** Scores each arm's answer against the task's gold answer
   (correct / partial / wrong + cited reasoning). Sees the gold answer + both
   answers ANONYMIZED ("Answer 1 / Answer 2", arm identity hidden, order varied).

The main agent orchestrates: per task, dispatch A and B concurrently, collect
each subagent's token usage (from the Task result) and answer, dispatch the
judge, record a row, then aggregate into the report.

## Committed artifacts

- **`bench/tasks.yml`** — ~10–12 tasks. Each: `id`, `prompt`, `gold_answer`,
  `category` (e.g. `github-discovery`, `open-web-info`, `synthesis-hard`,
  `botwalled`). Broad mixed set spanning webnav's strengths AND weaknesses.
- **`bench/README.md`** — the run recipe + the VERBATIM arm prompts (so re-runs
  use identical framing — no accidental coaching of one arm) + the judge rubric.
- **`bench/results/YYYY-MM-DD.md`** — a run's report (see Metrics).
- **`bench/load.ts`** — a tiny deterministic loader/validator for `tasks.yml`
  (the only unit-tested code). Validates: every task has id/prompt/gold/category;
  ids unique; category in the allowed set.

## Data flow (per task, × N tasks)

```
for each task in tasks.yml:
  dispatch Arm A (webnav, Sonnet)   → { answer_A, tokens_A }   ┐ concurrent,
  dispatch Arm B (baseline, Sonnet) → { answer_B, tokens_B }   ┘ independent
  dispatch Judge(gold, anonymized[answer_A, answer_B], Sonnet)
                                    → { score_1, score_2, reasoning }
  record row (de-anonymize scores back to A/B)
→ aggregate rows → write bench/results/<date>.md
```

Token counts come from each subagent's Task-result `usage`. Arms run concurrently
(one message, multiple Task calls). The judge runs after both answers are in.

## Metrics & report shape (`bench/results/<date>.md`)

- **Headline:** answer-quality tally (A wins / B wins / tie) + **median agent-token
  delta** (tokens_B − tokens_A). The thesis metric is agent tokens saved.
- **Per-category breakdown** — win/loss + token delta per category, so the report
  shows WHERE webnav wins (github-discovery) vs loses (synthesis-hard, botwalled).
- **Per-task table** — task id, both answers (truncated), both judge scores, both
  token counts, judge reasoning.
- **Caveats** — run-to-run variance, judge fallibility, sample size. Stated
  plainly, not buried. The report timestamps the run.

## Fairness controls (where benchmarks live or die)

- Identical task prompt to both arms — only the toolset differs.
- **Same model (Sonnet) for both arm-subagents** and the judge.
- Anonymized judging: arm identity hidden, answer order varied per task.
- Arm prompts committed VERBATIM in `bench/README.md` — re-runs use exact framing.
- Honest failure tasks included in the set AND the report.

## Testing (a non-deterministic experiment)

- **TDD only the deterministic piece:** `bench/load.ts` — unit tests assert it
  parses a valid `tasks.yml`, rejects a task missing a field, rejects duplicate
  ids, rejects an unknown category.
- **The experiment is validated by RUNNING it**, not by asserting agent outputs
  (non-deterministic). Validation procedure: smoke-run the pipeline on 1–2 tasks
  first (confirm a sensible scored row is produced end-to-end), then run the full
  set and write the report.
- **Reproducible, not deterministic** — re-running yields similar-but-not-identical
  numbers; the report notes variance. Correct for a benchmark.

## Out of scope (YAGNI)

- No standalone runner script / Claude Agent SDK dependency (orchestrated by the
  main agent).
- Not wired into `npm test` / CI (needs a live model + network; run deliberately).
- No statistical significance machinery (sample size ~10–12; report counts +
  medians + caveats, not p-values).
- webnav itself is unchanged — R1 adds NO code to the CLI/engine (only `bench/`).

## Success criteria

1. A committed, re-runnable benchmark (`bench/`) with a broad mixed task set +
   gold answers + verbatim arm prompts + a deterministic loader (unit-tested).
2. At least one full results report in `bench/results/` from a live run.
3. The report answers, with honest per-category breakdown: does agent+webnav
   save agent tokens and/or improve answer quality vs agent+plain-search, and on
   WHICH task categories — including where webnav loses.
