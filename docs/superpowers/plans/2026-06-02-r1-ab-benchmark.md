# R1 — A/B Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed, re-runnable A/B benchmark that pits *agent + webnav CLI* against *agent + plain web search* on a broad mixed task set, scored by an anonymized judge against gold answers, producing a results report on agent-token savings + answer quality.

**Architecture:** Mostly content + orchestration. The only code is a tiny deterministic `bench/tasks.yml` loader/validator (unit-tested). The "harness" is an orchestration recipe the main agent follows: dispatch a webnav-arm subagent (CLI only) + a baseline-arm subagent (WebSearch+WebFetch) + a judge subagent — ALL on Sonnet — per task, collect token usage + answers, and write a markdown report. webnav itself is unchanged (R1 adds no CLI/engine code).

**Tech Stack:** TypeScript (strict), Node 18+, vitest, the `yaml` dependency (already present). Live runs use the Task tool with the Sonnet model. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-r1-ab-benchmark-design.md`

---

## File structure

- **Create** `bench/tasks.yml` — the ~10–12 task set (id, prompt, gold_answer, category).
- **Create** `bench/load.ts` — `loadTasks(path)` / `parseTasks(text)`: parse + validate. The ONLY unit-tested code.
- **Create** `tests/bench/load.test.ts` — unit tests for the loader.
- **Create** `bench/README.md` — the run recipe + VERBATIM arm prompts + judge rubric.
- **Create** `bench/results/.gitkeep` — so the results dir exists; reports land here.
- **Modify** `docs/STATUS.md` — mark R1 built + point at `bench/`.

No changes to `src/` — webnav is untouched.

Categories (allowed set, used by the loader validator): `github-discovery`, `open-web-info`, `synthesis-hard`, `botwalled`.

---

## Task 1: The benchmark task set (`bench/tasks.yml`)

**Files:**
- Create: `bench/tasks.yml`

This is content, not code — no test step. The set is BROAD and MIXED on purpose (spec): webnav strengths + cases it loses. Gold answers are written to be judgeable (a fact or a defensible shortlist), not subjective.

- [ ] **Step 1: Write the task file**

Create `bench/tasks.yml`:

```yaml
# R1 A/B benchmark task set. Broad + mixed ON PURPOSE: includes tasks webnav
# does NOT cover well (synthesis-hard, botwalled) so wins are credible and the
# report shows WHERE the edge is. gold_answer is the rubric the judge scores
# against — a fact or a defensible shortlist, not a subjective opinion.
tasks:
  - id: gh-retry-lib
    category: github-discovery
    prompt: >
      Find a battle-tested, actively maintained Python library for retrying
      failed operations with backoff. Name the single best repo (owner/name)
      and justify with its declared signals (stars, recent commits, license).
    gold_answer: >
      A strong, defensible answer names a well-known maintained retry library —
      e.g. jd/tenacity (the de-facto modern choice; ~6k+ stars, active, Apache-2.0)
      or the older invl/retry. tenacity is the best single answer. The answer must
      cite concrete declared signals (stars / recent activity / license), not vibes.

  - id: gh-http-client
    category: github-discovery
    prompt: >
      Recommend the most battle-tested Python HTTP client library for a new
      project. Give one repo (owner/name) and its declared maintenance signals.
    gold_answer: >
      psf/requests (the canonical, hugely-starred, mature choice) or encode/httpx
      (modern, async, actively maintained) are both defensible. Either is correct
      if justified with declared signals. Naming an obscure/unmaintained lib is wrong.

  - id: gh-json-schema
    category: github-discovery
    prompt: >
      Find a well-maintained Python library for JSON schema validation. One repo
      (owner/name) + declared signals.
    gold_answer: >
      python-jsonschema/jsonschema is the canonical, well-maintained answer
      (widely used, active, MIT). pydantic (pydantic/pydantic) is also defensible
      for validation broadly. Must cite declared maintenance signals.

  - id: gh-compare-maintenance
    category: github-discovery
    prompt: >
      Between the 'requests' and 'httpx' Python HTTP libraries, which shows
      stronger recent maintenance signals right now? Cite the signals.
    gold_answer: >
      Either can be correct IF justified by current declared signals (recent
      commit recency, open/closed issues, release cadence). httpx tends to show
      more recent active development; requests is more mature/stable with huge
      adoption. A correct answer compares CONCRETE signals, not popularity alone.

  - id: ow-langchain-purpose
    category: open-web-info
    prompt: >
      What is the LangChain framework, in one or two sentences? What problem does
      it solve?
    gold_answer: >
      LangChain is an open-source framework for building applications powered by
      large language models — it provides composable abstractions (chains, prompts,
      tools/agents, memory, retrieval) to connect LLMs to data and actions.

  - id: ow-sqlite-wal
    category: open-web-info
    prompt: >
      What does SQLite's WAL (write-ahead logging) journal mode do, and name one
      tradeoff versus the default rollback journal.
    gold_answer: >
      WAL writes changes to a separate -wal file and commits by appending, letting
      readers and a writer proceed concurrently (readers don't block the writer and
      vice versa), usually improving write concurrency/throughput. Tradeoffs: extra
      -wal/-shm files, not ideal over network filesystems, and a checkpoint step is
      needed to fold the WAL back into the main db.

  - id: ow-semver-caret
    category: open-web-info
    prompt: >
      In npm semver, what version range does "^1.2.3" allow?
    gold_answer: >
      ^1.2.3 allows >=1.2.3 and <2.0.0 — i.e. any 1.x.y at or above 1.2.3, but not
      2.0.0 (it permits minor and patch updates, not a major bump). (For 0.x the
      caret is narrower, but for ^1.2.3 the answer is >=1.2.3 <2.0.0.)

  - id: ow-http-429
    category: open-web-info
    prompt: >
      What does HTTP status code 429 mean, and what header commonly tells a client
      when to retry?
    gold_answer: >
      429 Too Many Requests — the client has sent too many requests in a given time
      (rate limited). The Retry-After header commonly indicates how long to wait
      before retrying (seconds or an HTTP date).

  - id: syn-tradeoff-essay
    category: synthesis-hard
    prompt: >
      Weigh the tradeoffs of using a monorepo versus multiple repos for a 5-person
      startup, and give a concrete recommendation with reasoning.
    gold_answer: >
      A good answer is balanced: monorepo pros (atomic cross-cutting changes, shared
      tooling/CI, easy refactors, one source of truth) vs cons (tooling/scale, CI
      cost, access control); multi-repo the inverse. For a 5-person startup a
      monorepo is usually the pragmatic recommendation (low coordination overhead at
      small scale). This is a SYNTHESIS task — webnav has no special edge here; the
      baseline may match or beat it. Correctness = balanced tradeoffs + a justified
      recommendation, not which tool was used.

  - id: syn-explain-cap
    category: synthesis-hard
    prompt: >
      Explain the CAP theorem and what it means in practice for choosing a database.
    gold_answer: >
      CAP: a distributed system can guarantee at most two of Consistency,
      Availability, Partition-tolerance; since network partitions are unavoidable,
      the real choice under a partition is between consistency and availability
      (CP vs AP). In practice: pick CP (e.g. strongly-consistent stores) when correctness
      matters most, AP (e.g. eventually-consistent stores) when uptime/latency matters
      most. Synthesis task; no webnav edge expected.

  - id: bw-google-result
    category: botwalled
    prompt: >
      What is the current top organic Google search result for the query
      "best note taking app 2024"? Give the site/title.
    gold_answer: >
      This is intentionally HARD/uncertain: live Google SERP rankings are not stably
      knowable and Google bot-walls automated browsers (webnav will NOT evade — it
      detects + escalates). A correct/honest answer acknowledges the result is
      volatile/uncertain rather than fabricating a confident ranking. webnav is
      EXPECTED to lose or punt here; the baseline's WebSearch may do better. This
      task exists to show the honest boundary.

  - id: bw-paywalled-fact
    category: botwalled
    prompt: >
      According to a major paywalled news site, what was the headline of today's
      lead story?
    gold_answer: >
      Intentionally hard: paywalls + bot-walls block automated reading, and "today"
      is non-reproducible. An honest answer states it cannot reliably retrieve a
      live paywalled headline rather than fabricating one. Both arms may fail; the
      point is to observe honest failure vs hallucination, not to award a winner.
```

- [ ] **Step 2: Commit**

```bash
git add bench/tasks.yml
git commit -m "feat(bench): R1 task set (broad mixed: github/open-web/synthesis/botwalled)"
```

---

## Task 2: The task loader/validator (`bench/load.ts`) — TDD

**Files:**
- Create: `bench/load.ts`
- Test: `tests/bench/load.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/bench/load.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTasks, ALLOWED_CATEGORIES } from '../../bench/load.js';

const VALID = `
tasks:
  - id: a1
    category: github-discovery
    prompt: find a thing
    gold_answer: the thing is X
  - id: a2
    category: open-web-info
    prompt: what is Y
    gold_answer: Y is Z
`;

describe('parseTasks', () => {
  it('parses a valid task set', () => {
    const tasks = parseTasks(VALID);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ id: 'a1', category: 'github-discovery',
      prompt: 'find a thing', gold_answer: 'the thing is X' });
  });

  it('rejects a task missing a required field', () => {
    const bad = `
tasks:
  - id: a1
    category: github-discovery
    prompt: no gold here
`;
    expect(() => parseTasks(bad)).toThrow(/gold_answer/);
  });

  it('rejects duplicate ids', () => {
    const dup = `
tasks:
  - id: dupe
    category: open-web-info
    prompt: p
    gold_answer: g
  - id: dupe
    category: open-web-info
    prompt: p2
    gold_answer: g2
`;
    expect(() => parseTasks(dup)).toThrow(/duplicate/i);
  });

  it('rejects an unknown category', () => {
    const badcat = `
tasks:
  - id: a1
    category: not-a-real-category
    prompt: p
    gold_answer: g
`;
    expect(() => parseTasks(badcat)).toThrow(/category/);
  });

  it('rejects an empty / taskless file', () => {
    expect(() => parseTasks('tasks: []')).toThrow(/no tasks/i);
  });

  it('exposes the allowed categories', () => {
    expect(ALLOWED_CATEGORIES).toContain('github-discovery');
    expect(ALLOWED_CATEGORIES).toContain('botwalled');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bench/load.test.ts`
Expected: FAIL — module `bench/load.ts` not found.

- [ ] **Step 3: Implement the loader**

Create `bench/load.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const ALLOWED_CATEGORIES = [
  'github-discovery', 'open-web-info', 'synthesis-hard', 'botwalled',
] as const;
export type Category = (typeof ALLOWED_CATEGORIES)[number];

export interface BenchTask {
  id: string;
  category: Category;
  prompt: string;
  gold_answer: string;
}

/** Parse + validate the benchmark task set from YAML text. Throws on any
 *  structural problem so a malformed set can't silently skew a run. */
export function parseTasks(text: string): BenchTask[] {
  const doc: any = parse(text);
  const raw: any[] = doc?.tasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('bench task set has no tasks');
  }
  const seen = new Set<string>();
  const tasks: BenchTask[] = [];
  for (const t of raw) {
    for (const field of ['id', 'category', 'prompt', 'gold_answer'] as const) {
      if (typeof t?.[field] !== 'string' || t[field].trim() === '') {
        throw new Error(`task ${JSON.stringify(t?.id ?? '?')} missing required field: ${field}`);
      }
    }
    if (!ALLOWED_CATEGORIES.includes(t.category)) {
      throw new Error(`task ${t.id}: unknown category '${t.category}'`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
    tasks.push({ id: t.id, category: t.category, prompt: t.prompt.trim(), gold_answer: t.gold_answer.trim() });
  }
  return tasks;
}

/** Load + validate the task set from a YAML file path. */
export function loadTasks(path = 'bench/tasks.yml'): BenchTask[] {
  return parseTasks(readFileSync(path, 'utf8'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bench/load.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify the REAL task set loads (guards against a typo in Task 1's YAML)**

Run: `npx tsx -e "import('./bench/load.ts').then(m => console.log('tasks:', m.loadTasks().length))"`
Expected: prints `tasks: 12` (the count in `bench/tasks.yml`). If it throws, fix the YAML in `bench/tasks.yml`.

Note: if the `tsx -e` import form errors in this environment, instead add a temporary one-off test that calls `loadTasks('bench/tasks.yml')` and asserts `.length === 12`, run it, then remove it. Either way, CONFIRM the real file loads before committing.

- [ ] **Step 6: Commit**

```bash
git add bench/load.ts tests/bench/load.test.ts
git commit -m "feat(bench): tasks.yml loader/validator (TDD)"
```

---

## Task 3: The run recipe + verbatim arm/judge prompts (`bench/README.md`)

**Files:**
- Create: `bench/README.md`
- Create: `bench/results/.gitkeep`

Content task — no test step. The prompts here are VERBATIM (committed) so every
run uses identical framing — the core fairness control.

- [ ] **Step 1: Write the README**

Create `bench/README.md`:

````markdown
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
````

- [ ] **Step 2: Create the results dir placeholder**

Create `bench/results/.gitkeep` with content: a single line `# R1 run reports land here`.

- [ ] **Step 3: Commit**

```bash
git add bench/README.md bench/results/.gitkeep
git commit -m "docs(bench): run recipe + verbatim arm/judge prompts + results template"
```

---

## Task 4: Execute a live benchmark run + write the report

**Files:**
- Create: `bench/results/<today>.md` (today's date)

This task is performed by the ORCHESTRATOR (main agent), not a code subagent — it
dispatches the arm/judge subagents via the Task tool. There is no unit test; the
deliverable is a committed report from a real run.

- [ ] **Step 1: Smoke run (1–2 tasks)**

Dispatch Arm A + Arm B (Sonnet) on tasks `gh-retry-lib` and `ow-semver-caret`
using the verbatim prompts. Confirm: both return an `ANSWER:` line, the Task
result reports token usage, and the judge produces two verdicts. If the pipeline
misbehaves (e.g. an arm ignores its tool restriction), fix the prompt in
`bench/README.md` and re-smoke before proceeding.

- [ ] **Step 2: Full run (all tasks)**

Run the recipe over every task in `bench/tasks.yml`. Dispatch the two arms
concurrently per task; collect answers + token usage; judge anonymized; record rows.

- [ ] **Step 3: Write the report**

Fill the results template into `bench/results/<today>.md` with the real numbers:
headline tally + median token delta, the by-category table, the per-task table,
and the caveats (verbatim from the template — they are not optional).

- [ ] **Step 4: Sanity-check the report**

Confirm: every task appears exactly once; token deltas are computed B − A;
category subtotals sum to the totals; the caveats section is present. Fix any
arithmetic before committing.

- [ ] **Step 5: Commit**

```bash
git add bench/results/
git commit -m "bench(R1): first live results run (<N> tasks, sonnet arms+judge)"
```

---

## Task 5: Update STATUS.md

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update the pending list + add a bench note**

In `docs/STATUS.md`, change the R1 line in the PENDING list from item 1 to DONE,
and add a short section (near the verbs / DONE area):

```markdown
## R1 — A/B benchmark (DONE)

`bench/` holds a re-runnable A/B benchmark: agent+webnav (CLI only) vs
agent+plain-search (WebSearch+WebFetch), both Sonnet, scored by an anonymized
Sonnet judge against gold answers. Broad mixed task set (`bench/tasks.yml`,
unit-tested loader `bench/load.ts`); run recipe + verbatim prompts in
`bench/README.md`; reports in `bench/results/`. First run: see the latest
`bench/results/<date>.md`. Honest by design — includes synthesis/botwalled tasks
where webnav is expected to lose. Spec: `docs/superpowers/specs/2026-06-02-r1-ab-benchmark-design.md`.
```

Also renumber the remaining PENDING items (R5 becomes #1, etc.) and bump the test
count line (run `npx vitest run` and read the number — the 6 loader tests are new).

- [ ] **Step 2: Build + full suite green**

Run: `npm run build`
Expected: tsc succeeds.

Run: `npx vitest run`
Expected: all pass (previous total + 6 loader tests), gated e2e skipped.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: mark R1 A/B benchmark done; point at bench/"
```

---

## Self-review notes (for the implementer)

- **`bench/` is a new top-level dir** (not under `src/`). `bench/load.ts` is imported
  by the test as `../../bench/load.js` — confirm tsconfig `include` covers `bench/`
  or the test still resolves it via tsx/vitest (vitest uses esbuild, so a `.ts`
  under the repo root resolves fine even if `tsc --noEmit` doesn't include it; if
  `npm run build` complains about `bench/`, add `bench/**/*.ts` is NOT needed for
  the build — keep bench out of the dist build; vitest handles it. If tsc errors,
  exclude `bench` in tsconfig rather than shipping it to dist).
- **Tasks 1 & 3 are content** (no TDD) — only Task 2 (loader) is unit-tested, and
  Task 4 is a live orchestration run (validated by running, not asserting).
- **Token usage source:** each Task-tool result reports `usage` (subagent_tokens).
  Use that as the per-arm token figure.
- **Fairness is in the prompts:** do not edit one arm's prompt without the other;
  keep them committed verbatim; vary answer order into the judge per task.
- **Honest failures stay in the report** — do not drop botwalled/synthesis tasks
  if webnav loses; that's the point.
