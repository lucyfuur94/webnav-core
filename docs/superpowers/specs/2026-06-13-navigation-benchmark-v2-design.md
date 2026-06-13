# Navigation benchmark v2 — webnav-walk vs raw-browser (saucedemo + OrangeHRM)

**Date:** 2026-06-13 · **Status:** design, ready to implement · **Supersedes the metrics/fairness
sections of** `2026-06-03-navigation-benchmark-design.md` (+ its saucedemo addendum) · **Corrects the
failure modes exposed by** `bench/results/2026-06-13-nav.md`.

**REQUIRES A LIVE BROWSER + OPEN NETWORK** (`playwright-cli` on PATH, both sites reachable). Cannot
run sandboxed/headless-cloud. Run from a dev machine. Both sites are fully login-gated; both sites'
creds are already stored (`webnav dev creds`).

## 0. The thesis as a falsifiable claim

webnav's cost win is **the calling agent's LLM tokens + wall-clock** — NOT playwright page-loads. The
benchmark isolates *agent reasoning effort to reach a deep, NON-addressable state B and read the right
signal there*, holding everything else constant. That is the only task shape where a remembered route
can beat ad-hoc driving.

The prior run (`bench/results/2026-06-13-nav.md`, Sonnet) proved three things this design fixes:
1. **Tokens were spawn-floor-dominated (~18.6k).** Raw totals did NOT separate the arms (A ~38k vs
   C ~35k). A raw token total is the wrong headline.
2. **The agent defaulted to manual driving in 3/4 arm-A runs**, collapsing A into C — so it measured
   "did the agent happen to use the walk," not "walk vs raw browser."
3. **The one run that actually used the walk was 9 calls / 68s vs 22.5 median** — the signal is real,
   but only visible when the arm is *forced* to use its instrument.

v2 therefore: **forces the arm's instrument, counts floor-subtracted marginal tokens, makes wall-clock
a co-headline (floor-free), runs N≥5 per cell, scores cost only over `correct` runs.**

## 1. The arms (A vs C compared; B is a control)

| Arm | Instrument | Behaviour |
|---|---|---|
| **A — webnav walk** | `webnav walk`/`walk-resume` + pause/resume. `use`-primitives ONLY to fire a gate at a pause. | "take me to goal G"; reasons only at genuine forks. |
| **C — raw browser** | `playwright-cli` `use`-primitives ONLY. No map. | Drives every step: snapshot → read → pick ref → act → repeat. |
| **B — baseline (control)** | WebSearch/WebFetch | Can't reach a logged-in state. Run once/site, scored `wrong`. Not in the A-vs-C cut. |

Both A and C use the **same playwright-cli + same `use`-primitives** — the only difference is whether a
remembered route drives them. `walk` takes **state IDs** (`<host>:<semantic-name>`), not URLs.

## 2. Metrics

**SUCCESS (gate)** — `reached_B` (verified from trace + final-snapshot state fingerprint, not the
agent's say-so), `read_correct` (right signal, live evidence not derived/memorized), `quality ∈
{correct,partial,wrong}`. Judged by an **anonymized 3-way LLM judge** (arm identity + reliability tag +
trace hidden) PLUS a deterministic exact-value cross-check by the orchestrator. **Cost/time reported
ONLY over `correct` runs.**

**COST — agent tokens (floor-corrected).** Capture `tokens_in` / `tokens_out` separately (the walk's
claim is mostly an *input-token* claim — the agent stops ingesting big snapshots). Measure the spawn
floor once per batch with a **no-op calibration arm** (same harness, prompt "reply OK", N runs →
median = FLOOR). Report **`tokens_marginal = total − FLOOR`** (the navigation-attributable figure;
the prior A38k/C35k ≈ 19.4k vs 16.4k of real work once the floor is removed). Median + IQR.

**WALL-CLOCK (co-headline, floor-free).** `duration_s` from dispatch to final ANSWER. Promoted to
co-headline because it carries no spawn floor and is the user-felt half. Median + IQR over `correct`.

**DIAGNOSTIC (not headline):** tool-calls/steps, wrong-clicks, walk resumes, reliability tag
(`clean` / `recovered` / `protocol-abandoned`). An arm-A run that ignored the walk and drove manually
is tagged `protocol-abandoned` and reported SEPARATELY — it's a discoverability finding, not a
capability measurement.

## 3. Task table (multi-step; arrival judged by observable evidence, never by path)

### saucedemo (`standard_user`/`secret_sauce`)
| # | Diff | Start → Goal | Arrival evidence |
|---|---|---|---|
| **S1** | easy | login → inventory | 6 product tiles w/ name+price; empty cart badge. (/inventory.html 302s to login when unauth — not URL-guessable.) |
| **S2** | med | login → product-detail (Fleece Jacket) | $49.99 **AND** a faithful description fragment **AND** "Back to products". Price off the tile = FAIL. |
| **S3** | hard | login → cart → checkout-info → checkout-overview (Backpack+Bike Light, pre-order) | Item $39.98 / Tax $3.20 / Total $43.18 read off overview; 2 line items; order NOT placed. (navigate edges + add-to-cart mutates + input-gated form + stop at commit.) |

### OrangeHRM (`Admin`/`admin123`)
| # | Diff | Start → Goal | Arrival evidence |
|---|---|---|---|
| **O1** | easy | auth-login → recruitment-viewcandidates (any route) | "Recruitment › Candidates"; candidates table w/ declared columns; Add + Vacancy filter. (regression anchor — Haiku already did this w/ 1 resume.) |
| **O2** | med | auth-login → pim-viewemployeelist | "PIM"/"Employee Information"; table cols (Id, First/Last Name, Job Title, Employment Status, Sub Unit, Actions); Add + Search reveal. (deep interior; heavy UI a raw agent gets lost in.) |
| **O3** | hard | auth-login → pim-viewemployeelist FILTERED to one employee (reveal Search → input name → mutate submit) | Table shows ONLY matching rows (or "No Records Found"). **Pick the filter name at runtime** (read one real name first, then filter to it) — the demo dataset is shared/mutable. (arrival is an in-page STATE CHANGE, not a URL — the recognize-by-fingerprint regime.) |

`bench/tasks-nav.yml` already encodes S2/S3 (+ a commit-firing `nav-complete-order` variant — keep
separate). Add S1 + O1–O3, and an `'orangehrm-nav'` category to `ALLOWED_CATEGORIES` in `bench/load.ts`
(+ loader test). saucedemo keeps `'saucedemo-nav'`.

## 4. Fairness controls (explicit, BOTH directions — each equally invalidating)
- **Same model, both arms: Haiku** (`claude-haiku-4-5-20251001`) — the deliberate dogfood (cheap
  agent + deterministic walk vs expensive agent ad-hoc-driving). Held constant across A/C (the
  hold-model-constant benchmark exception, now Haiku not Sonnet).
- **Same prompts** except the one instrument paragraph; **same tasks/order**; **distinct `-s=`
  sessions** per arm.
- **Force the instrument.** Arm A's prompt MANDATES `walk` first and forbids ad-hoc `use` except to
  fire a gate at a pause (this is the fix for the 3/4-collapse). Tag violations `protocol-abandoned`.
- **N ≥ 5 per (task,arm) cell**; report median + IQR, never a point (spawn floor + stochastic
  session-drop swamp single runs).
- **Pre-warm parity:** the map is pre-seeded; the raw arm gets creds in-prompt. Both measure
  steady-state recall ("the second time"), which is the thesis.
- Do NOT: strawman arm C, pick tasks only webnav's exact route can do, aim a task at a known walk
  fork to deflate A, headline the one task where the walk shines, or count A's pause/resume as failure.

## 5. Honest expectations (so we don't fool ourselves)
- **WHERE A SHOULD WIN:** the hard, deep tasks (S3, O2, O3) — fewer marginal input-tokens (agent
  stops ingesting per-step snapshots) and lower wall-clock (fewer round-trips). This is the thesis.
- **WHERE A TIES OR DOESN'T WIN:** the easy 1-hop tasks (S1, O1) — too short for recall to amortize;
  a competent agent gets there either way (the prior run already showed quality ties on saucedemo).
- **WHERE A PAYS A KNOWN COST:** O1/O3 forks that cost a `walk-resume` (the Recruitment drift; the
  in-page filter). Report these honestly as resumes, not hide them.
- **WHAT A NEGATIVE RESULT LOOKS LIKE:** if floor-subtracted marginal tokens + wall-clock DON'T
  separate on the hard tasks, the navigation thesis is unproven on these sites — report that plainly.
  A null result is a result. (The known UX wart — no bare-continue resume, R5.1 — could be what's
  costing A; if so, that's the fix, and the benchmark says so.)

## 6. Harness shape
Extend `bench/load.ts` + `bench/README.md`'s runner. Per (task, arm, run): dispatch a Haiku subagent
with the task + arm-instrument prompt + creds-already-stored note; capture its `tokens_in`/`out`/
`duration_s`/tool-trace from the Task result; the orchestrator records `reached_B` from the trace +
final snapshot, runs the exact-value check, and hands the anonymized answer to the 3-way judge. Run the
no-op calibration arm once for FLOOR. Aggregate median+IQR over `correct` runs; write
`bench/results/<date>-nav-v2.md` with the headline (marginal tokens + wall-clock + quality), the
per-task table, the reliability/protocol-abandoned tags, and the honest expectation-vs-result read.

## Out of scope
- Cross-site / multi-map tasks (stitching). - Usage-weighted routing (hosted, webnav-site).
- Anything needing the deleted recall/route engine.
