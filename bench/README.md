# R1.1 — Benchmark: agent + webnav vs agent + plain search vs agent + raw browser

An executable experiment. The main agent (orchestrator) runs it by following
this recipe; results land in `bench/results/<date>.md`. Spec:
`docs/superpowers/specs/2026-06-02-r1.1-live-benchmark-design.md`.

webnav itself is untouched and zero-LLM — the judge here is a BENCHMARK tool only.

## What it measures

Per task, THREE arms answer the SAME prompt with DIFFERENT tools, all on **Sonnet**:
- **Arm A (webnav):** the `webnav` CLI ONLY (recall/search/route + evidence bundle).
- **Arm B (baseline):** Claude's WebSearch + WebFetch ONLY.
- **Arm C (raw browser):** `playwright-cli` ONLY — the same browser webnav uses
  underneath, but with NO webnav map; the agent navigates the live site itself.

A **judge** (Sonnet) scores all three answers against the task's `gold_answer`
RUBRIC, seeing them ANONYMIZED ("Answer 1/2/3", order varied). **The headline cut
is A vs C** — does webnav's navigation skeleton beat an agent ad-hoc-driving the
same browser? Every R1.1 task requires a LIVE fetch (no answering from memory);
gold answers are plausible+sourced rubrics, so a memory-answer scores wrong.

## How to run (orchestrator recipe)

1. `loadTasks('bench/tasks.yml')` (or read the file) to get the tasks.
2. SMOKE: run steps 3–5 on the first 1–2 tasks only; confirm a sensible 3-way
   scored row is produced end-to-end before running the full set.
3. For each task, dispatch **Arm A**, **Arm B**, and **Arm C** concurrently (one
   message, three Task calls, all `model: sonnet`), using the verbatim prompts
   below. Arm A and Arm C both drive playwright-cli — they MUST use distinct
   sessions (different `-s=` names) so they never collide.
4. Capture each arm's final answer text AND its token usage from the Task result.
5. Dispatch the **Judge** (Sonnet) with the gold rubric + all three answers in a
   RANDOMIZED order, arm identity hidden ("Answer 1/2/3"). Record the per-answer
   verdict (correct | partial | wrong) + reasoning; de-anonymize to A/B/C.
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

## Arm C prompt (raw browser) — VERBATIM

```
You are answering using ONLY the `playwright-cli` browser tool. You do NOT have
webnav, WebSearch, or WebFetch.

playwright-cli drives a real browser. Common commands (run via your shell):
  playwright-cli open <url>      # open the browser at a URL
  playwright-cli goto <url>      # navigate
  playwright-cli snapshot        # capture the page (text + element refs)
  playwright-cli click <ref>     # click an element
  (run `playwright-cli --help` for the full verb list)

Navigate to the relevant site yourself and read the answer off the live page.
Do NOT answer from prior knowledge — fetch it.

Task: <PROMPT>

Answer concisely. If you cannot retrieve it, say so honestly. End with:
ANSWER: <final answer in 1-3 sentences>
```

## Judge prompt — VERBATIM

```
You are an impartial grader. Score THREE candidate answers against a gold-answer
rubric. Reward correctness and honest uncertainty; do NOT reward verbosity or
confidence. The task required fetching a LIVE value — an answer that gives a
specific current value WITH evidence it was fetched (cites a page/number/date) is
correct; a vague, stale, guessed, or unsourced value is wrong; on an unfetchable
task, an honest "can't retrieve it" beats a fabricated confident answer.

QUESTION: <PROMPT>
GOLD RUBRIC: <GOLD_ANSWER>

Answer 1: <ANSWER_X>
Answer 2: <ANSWER_Y>
Answer 3: <ANSWER_Z>

For EACH answer return: verdict (correct | partial | wrong) + one sentence of
reasoning citing the rubric. Respond as:
Answer 1: <verdict> — <reason>
Answer 2: <verdict> — <reason>
Answer 3: <verdict> — <reason>
```

## Results template (`bench/results/<date>.md`)

```markdown
# R1.1 results — <date>

Model: sonnet (all three arms + judge). Tasks: <N> from bench/tasks.yml (live-data).
NOTE: live run — numbers vary run-to-run; this is one sample.

## Headline
- Answer quality: webnav <a> / baseline <b> / raw-browser <c> (correct counts, of <N>)
- Median agent-tokens: webnav <ta> · baseline <tb> · raw-browser <tc>
- KEY CUT (A vs C): on <X>/<N> tasks webnav matched-or-beat raw-browser on quality;
  median token delta (C − A) = <Δ>

## By category
| category | tasks | webnav correct | baseline correct | raw-browser correct |
|---|---|---|---|---|
| github-live | … | … | … | … |
| web-live | … | … | … | … |
| botwalled | … | … | … | … |

## Per task
| id | category | webnav | baseline | raw-browser | tok A | tok B | tok C |
|---|---|---|---|---|---|---|---|
| … | … | … | … | … | … | … | … |

## A vs C focus (the thesis cut)
One paragraph: did webnav's skeleton beat ad-hoc browser driving — on quality,
on tokens, on reliability (render races / bot-walls Arm C hit)? Honest read.

## Caveats
- One live sample; re-running varies. Judge is an LLM (fallible).
- playwright-cli (Arms A & C) can hit bot-walls / render races / slow loads —
  those are REAL outcomes, not harness bugs.
- Live values drift; rubric scoring handles it; run timestamped above.
- Sample size <N>; directional evidence, not a significance test.
```
