# R1 — A/B Benchmark: agent + webnav vs agent + plain search

An executable experiment. The main agent (orchestrator) runs it by following
this recipe; results land in `bench/results/<date>.md`. Spec:
`docs/superpowers/specs/2026-06-02-r1-ab-benchmark-design.md`.

webnav itself is untouched and zero-LLM — the judge here is a BENCHMARK tool only.

## What it measures

Per task, two arms answer the SAME prompt with DIFFERENT tools, both on **Sonnet**:
- **Arm A (webnav):** the `webnav` CLI ONLY (no WebSearch/WebFetch).
- **Arm B (baseline):** Claude's WebSearch + WebFetch ONLY (no webnav).

A **judge** (Sonnet) scores each answer against the task's `gold_answer`,
seeing the answers ANONYMIZED. Headline metrics: answer-quality tally + median
agent-token delta (B − A). Token counts come from each subagent's Task-result usage.

## How to run (orchestrator recipe)

1. `loadTasks('bench/tasks.yml')` (or read the file) to get the tasks.
2. SMOKE: run steps 3–5 on the first 1–2 tasks only; confirm a sensible scored
   row is produced end-to-end before running the full set.
3. For each task, dispatch **Arm A** and **Arm B** concurrently (one message,
   two Task calls, both `model: sonnet`), using the verbatim prompts below.
4. Capture each arm's final answer text AND its token usage from the Task result.
5. Dispatch the **Judge** (Sonnet) with the gold answer + both answers in a
   RANDOMIZED order with arm identity hidden ("Answer 1 / Answer 2"). Record the
   per-answer score (correct | partial | wrong) + reasoning; de-anonymize to A/B.
6. Aggregate and write `bench/results/<date>.md` (template below).

## Arm A prompt (webnav) — VERBATIM

```
You are answering a question using ONLY the `webnav` CLI tool (a zero-LLM web-
navigation tool). You do NOT have WebSearch or WebFetch — do not use them.

First run `webnav --help` to discover the available verbs, then use them
(e.g. `webnav recall "<use-case>"`, `webnav search "<query>"`, `webnav route`,
`webnav locate`) to gather evidence. webnav returns structured evidence; YOU do
the reasoning/ranking.

Task: <PROMPT>

Answer concisely and concretely. If you cannot determine a reliable answer with
the available tools, say so honestly rather than guessing. End with a line:
ANSWER: <your final answer in 1-3 sentences>
```

## Arm B prompt (baseline) — VERBATIM

```
You are answering a question using ONLY Claude's built-in WebSearch and WebFetch
tools. You do NOT have any `webnav` tool — do not attempt to use it.

Task: <PROMPT>

Answer concisely and concretely. If you cannot determine a reliable answer with
the available tools, say so honestly rather than guessing. End with a line:
ANSWER: <your final answer in 1-3 sentences>
```

## Judge prompt — VERBATIM

```
You are an impartial grader. Score two candidate answers against a gold answer.
Do NOT reward verbosity or confidence — reward correctness and honest uncertainty.
An answer that fabricates a confident result on an unanswerable task is WRONG; an
answer that honestly says it can't determine the result is at least PARTIAL.

QUESTION: <PROMPT>
GOLD ANSWER (rubric): <GOLD_ANSWER>

Answer 1: <ANSWER_X>
Answer 2: <ANSWER_Y>

For EACH answer return: verdict (correct | partial | wrong) + one sentence of
reasoning citing the gold rubric. Respond as:
Answer 1: <verdict> — <reason>
Answer 2: <verdict> — <reason>
```

## Results template (`bench/results/<date>.md`)

```markdown
# R1 results — <date>

Model: sonnet (both arms + judge). Tasks: <N> from bench/tasks.yml.
NOTE: live run — numbers vary run-to-run; this is one sample.

## Headline
- Answer quality: webnav <w>/baseline <b>/tie <t> (of <N>)
- Median agent-token delta (baseline − webnav): <Δ> tokens

## By category
| category | tasks | webnav wins | baseline wins | tie | median token Δ |
|---|---|---|---|---|---|
| github-discovery | … | … | … | … | … |
| open-web-info | … | … | … | … | … |
| synthesis-hard | … | … | … | … | … |
| botwalled | … | … | … | … | … |

## Per task
| id | category | webnav verdict | baseline verdict | webnav tok | baseline tok | judge note |
|---|---|---|---|---|---|---|
| … | … | … | … | … | … | … |

## Caveats
- One live sample; re-running varies. Judge is an LLM (fallible) — spot-check close calls.
- Open-web/botwalled tasks are capped by automation-friendly engines (webnav does
  not evade bot-walls); baseline's WebSearch may legitimately win there.
- Sample size ~<N>; treat as directional evidence, not a significance test.
```
