# webnav — STATUS (live handoff)

**Updated:** 2026-07-11 · **Branch:** `structure-inference` (merging to `main`) · **Tests:** 673 unit pass + 7 skip (live e2e) · **Build:** green

> **2026-07-11 — STRUCTURE INFERENCE shipped: recording→graph is now observation-based, zero site-tuned heuristics.**
> Full redesign per `2026-07-10-structure-inference-design.md` + plan `2026-07-10-structure-inference.md`.
> The draft engine infers structure from five site-agnostic evidence axes (settledness/aliases ·
> ARIA declaration · cross-page shell · cross-visit template cores with `provisional` marking ·
> within-page repetition folds); identity = URL-template × structural-template (propose/dispose,
> control-face arm, containment for partial renders, fixpoint multi-param merge); recorder settles
> before capture and records `requestedUrl` (incl. clicked links' declared hrefs) on all agent paths;
> `_shell` state carries site chrome once (from-anywhere edges, heal writes back to the owner);
> foreign-host landings are excluded as blocked doors (never states); the map REPORTS what to record
> next (`receipt.requests`) and the dashboard badges provisional states. Deleted: ID_SEG, pathSlug,
> RECORD_COUNT_RE, subTabContainer, union-of-mutation-afters, `-2` suffixes — enforced by
> `tests/guidelines.test.ts`.
> **Validated live on four sites, same code, no site conditionals:**
> - **progneo** (6 real sessions): ONE confirmed `report` builder (template `/report/{param}/{param}`,
>   22 page-level affordances, 12/12 ground-truth actions), shell extracted, no ghost states, no
>   data-values, no instance-heading fingerprints; SSO wall reported as a blocked door, not a state.
> - **saucedemo**: seeded walk login→checkout-complete completes end-to-end (resume protocol intact).
> - **OrangeHRM**: the historical redirect-mismatch mesh bug is CLOSED (declared-href aliases);
>   login state modeled (inputs + acceptsInput:credentials); partial-render landings no longer
>   lose pages (containment clustering); grid columns reach the shadow.
> - **automationexercise**: two product pages merge into ONE `product-details` template state,
>   cross-instance confirmed, no product names anywhere.
> **Open items:** (1) progneo dashboard confirm-visit blocked by Cloudflare SSO mid-session —
> needs a user re-login, then `dashboard` confirms and its needsFix clears; (2) GATED: the human
> recorder (`live-record.ts`) still lacks declared-href `requestedUrl` capture (same fix as the
> agent paths; capture-engine edits await explicit user OK); (3) `ingest.ts` extension path
> (deprecated) unpatched; (4) follow-up nits from the final
> whole-branch review (one cleanup pass): degenerate reason string says 'blank/empty' for the
> all-tokens-collided case (draft.ts ~565/575) · kind+label dedup can double a control as
> mutate+reveal (draft.ts ~608) · row-scoped navigate templates for instance-named row links
> (the 'Testuser' edge-label class) · shell-heal test should drive healStep directly · a
> focused mixed-role negative test for foldRepeats.
> Review-flow audit (2026-07-10, below-referenced): review gates capture completeness; analyse
> `requests` is the separate structural-refine loop — deliberately NOT conflated.

> **2026-07-08 — control center hardened through 8 live test-drive batches + FLOW VARIABLES.**
> The dashboard Recordings control center (built 2026-07-07) was exercised hands-on and hardened:
> one combined TICK_JS eval per tick (playwright-cli calls are ~300-500ms process spawns,
> serialized — tick economy was the root of every lag complaint) · SSE realtime everywhere
> (no polling; pill POSTs its toggle straight to the dashboard — Chrome exempts 127.0.0.1
> from mixed-content; desired-state + a 1.5s pin beat stale-tick races) · OS-level window-
> close detection (ps: daemon's Chromium child) killed the daemon-resurrection reopen loop ·
> session VIDEO takes per Record→Stop span (ground truth for capture completeness) · armed
> mode drops events (no phantom logs) · per-recording window presence + armed-only reopen ·
> Logs/Videos sub-tabs with live streams · **flow VARIABLES: non-secret input values are
> recorded on the step (ActionRef.value) and replay uses them as defaults — a recorded flow
> re-runs with different inputs (automated testing). Secret guard widened + unit-enforced:
> password / cc-* / current-password / new-password / one-time-code never captured.**
> Suite 506 pass / 7 skip. Open discussion: one recording accumulates multiple video takes
> across Record→Stop cycles (kept deliberately; revisit with user).

> **2026-07-07 (control center) — dashboard Recordings tab wired end-to-end.**
> - Real deps (`RecordStore`, `runLiveRecord`, `ReplayController`/`runReplay`, `draftFromEffects`,
>   `PlaywrightAdapter`) are now wired into `webnav dev dashboard`'s `RecordingsDeps`, replacing the
>   503-unwired stub. From the dashboard: **New recording** opens a browser armed (grey, not yet
>   recording) — the human clicks Record to arm capture, and a red overlay ⏺ shows on the driven
>   page throughout; **recordings list** shows past sessions; **Replay** verifies a recording headed,
>   with a per-step filmstrip of screenshots turning green as steps complete; stored credentials
>   auto-fill login fields during replay, and an unrecognized field **pauses and asks** the human
>   (cred-inject), offering to save the answer; commit-labeled steps (Place Order/Pay/Delete/…)
>   pause for an explicit confirm and never auto-fire. Only **one driven browser at a time** — a
>   second Open/Replay while one is up returns a clear "already open" error instead of stacking
>   Chrome processes.
> - Unit-tested throughout the underlying pieces (record store, live-record loop, replay controller,
>   draft-from-effects); this increment is the CLI wiring + docs only — see `tsc`/`vitest` below.
> - **Tests:** full suite **494 pass / 7 skip**; `tsc --noEmit` clean.
> - **⚠️ Live acceptance pending** — human, driving the actual dashboard end-to-end (New recording →
>   Record → click through saucedemo → Stop → Replay with creds autofill + filmstrip + a
>   commit-confirm pause). Not yet run.

> **2026-07-07 (later) — capture pivot: `dev record-live` (playwright-cli) replaces the extension.**
> - **The pivot (evidence, not argument):** the Chrome-extension capture below reconstructed the
>   a11y tree from the raw DOM in JS; on a React SPA (saucedemo) that approximation collapsed —
>   roles `generic`, names = whole-subtree textContent blobs → `graph-analyse` produced **0 edges**.
>   The real in-browser a11y API (`chrome.automation`) is dev-channel-only, so it's not a fix. A
>   live proof through playwright-cli's REAL a11y snapshot, capturing the same saucedemo login flow,
>   produced a correct draft instead: a `home → inventory-html` navigate edge **with auto-detected
>   credentials linkage** (`needs:[inp_username,inp_password]`, `acceptsInput:credentials`). Same
>   site, same flow: extension 0 edges, playwright-cli correct map. The extension is now **shelved**
>   — kept in-tree as a documented dead-end; `dev ingest` remains (harmless, reusable).
> - **New verb:** `webnav dev record-live --session S --url U [--interval ms]` — opens a HEADED
>   browser at `U`; the human clicks through the site naturally; every action is captured as
>   `ActionEffect`s (REAL playwright a11y snapshots) into the record buffer. Stop with Ctrl-C or
>   `dev record-stop --session S`. From there, the unchanged pipeline: `dev graph-analyse --session <S>
>   --draft` → `graph-edit` → `walk`.
> - **How it captures:** an injected in-page listener only reports WHICH element was touched (a
>   one-element descriptor per click/change), via a `sessionStorage` queue that survives navigation
>   — never the full page/tree. Typed values are **never** recorded (secret-field rule): an `input`
>   event records that a field changed and which field, never its content.
> - **Tests:** +16 unit (14 `live.test.ts` pure core, 2 `live-record.test.ts` loop); full suite
>   **472 pass / 7 skip**; `tsc` clean.
> - **✅ Live acceptance PASSED (2026-07-07):** a human free-clicked saucedemo (login→add-to-cart→
>   cart→checkout form) in `record-live`; the draft produced 6 states incl. the `home→inventory`
>   navigate edge with `needs:[inp_username,inp_password]` + `acceptsInput:credentials`; the drafted
>   map was authored via `graph-edit` (isolated DB) and **`walk home→inventory` completed
>   (status: done) with stored creds auto-filled — zero-LLM, end-to-end from human clicks.**
>   The run surfaced + fixed 6 defects: eval-per-tick reinstall (playwright evals run in fresh JS
>   worlds → guard moved to the DOM), submit-button labels (the one sanctioned .value read),
>   `graph-analyse` positional-session parsing (silently queried '' → "empty"), the Ctrl-C
>   teardown race, **draft fingerprint EXCLUSIVITY** (self-match-only greedy left ambiguous fps),
>   and **`ensureSeeded` resurrecting the saucedemo seed over user-touched nodes** (node-clear was
>   silently undone on every open; guard is now the node row). A red border + REC pill shows on
>   every page while recording (aria-hidden — never in snapshots).
> - **Next increment (not built):** prompted credential-inject during recording — when a login
>   field is reached and creds exist for the site, offer to inject; if none stored, offer to save
>   (first login = enrollment). Rides the existing creds store + `walk` auto-fill.
> - Design: `docs/superpowers/specs/2026-07-07-playwright-recorder-design.md`; plan:
>   `docs/superpowers/plans/2026-07-07-playwright-recorder.md`.

> **2026-07-07 — human-session recorder: a second, real-usage producer into the same map (DONE except manual browser smoke).** ⚠️ **Superseded the same day** — this capture approach (Chrome-extension DOM-walk a11y approximation) proved broken on SPAs; see the "capture pivot" entry above for the evidence and the replacement (`dev record-live`, playwright-cli-based). Kept here as a documented dead-end.
> - **What it is:** a Chrome MV3 extension (`webnav-recorder/`, isolated package) records real
>   human browsing and POSTs it to a new `webnav dev ingest --port 7778` localhost receiver, which
>   writes `ActionEffect`s to `webnav.db` via the SAME `RecordStore` the agent-record path
>   (`record-start`/`use`/`record-stop`) already uses. **Two producers, one sink** — from the
>   ingested effects onward, the existing `graph-analyse [--draft]` → `graph-edit` → `walk`
>   pipeline is completely UNCHANGED; the agent-record path is untouched.
> - **Strategic context:** this is the map-building **data-source** pivot. Record-replay as a
>   *mechanic* is already table stakes (Stagehand ~23k★, workflow-use ~4k★ ship it). webnav's wedge
>   isn't the mechanic — it's the **data source**: real human usage feeding the same navigation
>   memory an agent would otherwise have to build by driving the browser itself.
> - **New verb:** `webnav dev ingest [--port 7778]` — starts a localhost HTTP receiver (`/ingest`),
>   long-running like `dashboard`/`mcp`.
> - **Flow for a human:** `webnav dev ingest` → load `webnav-recorder/` unpacked in Chrome → Record
>   → do the flow → Stop & send → `webnav dev graph-analyse --session <id> --draft` → `graph-edit` →
>   `walk`, same as an agent-recorded session.
> - **Secret-field rule:** password/credit-card field VALUES are never recorded — only element
>   fingerprints, never `.value`.
> - **Capture survives navigation:** the click→settle correlation lives in the background worker
>   (persisted in `chrome.storage.session`), NOT in the content script — a real page-to-page
>   navigation destroys the content-script context. Captures page-to-page navs, same-page
>   (`navigated:false`) clicks, and SPA History-API navigations. `navigated` is recomputed
>   server-side (`didNavigate`, host+path) so it matches the agent path; re-recording into the same
>   session id replaces (never duplicates) via `RecordStore.clearSession`.
> - **Tests:** +7 unit tests (2 serializer parity, 5 for `dev ingest` incl. HTTP round-trip,
>   server-side `navigated`, and re-ingest-replaces); full suite **456 pass / 7 skip**; the
>   extension compiles via `tsc -p`; the serializer twin is byte-identical to the in-repo oracle
>   and content.ts's ref numbering aligns with it.
> - **⚠️ Pending — manual browser smoke (the one human step):** `webnav dev ingest` → load
>   `webnav-recorder/` unpacked → record saucedemo login→cart → Stop & send → `graph-analyse
>   --draft` → `graph-edit` → `walk`. This validates the DOM-walk role/name fidelity against a real
>   page (the plan's flagged #1 risk — `domToSNode` approximates the a11y tree; `draft` verify-
>   before-emit drops unresolvable fingerprints rather than mis-clicking, so it's a quality ceiling,
>   not a correctness hole). If human-recorded elements fail to resolve on the walk, upgrade
>   `domToSNode` toward `chrome.automation` (real a11y tree) before suspecting the pipeline.
> - **Follow-up (not built, v1 scope):** a human recording captures clicks/navigation only — no
>   typing (secret-field rule) — so `draft`'s login `needs`/`acceptsInput:credentials` linkage
>   (which keys off recorded `textbox` input actions) won't fire for human sessions; a walked login
>   won't auto-fill creds at that step. Fine for click-navigation flows; revisit if needed after the
>   smoke (a `focus`/`change`-triggered input step carrying only the field fingerprint, never the value).
> - Design: `docs/superpowers/specs/2026-07-07-human-session-recorder-design.md`; plan:
>   `docs/superpowers/plans/2026-07-07-human-session-recorder.md`.

> **Handoff note (2026-07-07):** this file's last dated entry before today was 2026-06-13, but
> ~24 commits landed on `main` in between that this file never captured: the import-map flow +
> shipped map packs (`mappacks/`, `dev import-map`, referenced in README's Quickstart), a
> navigation-benchmark v2 (`bench/results/2026-06-13-nav-v2.md`, referenced from the README), and
> `ADOPTION.md`/discoverability work (positioning + `awesome-mcp-servers` listing). None of that
> is re-narrated here in detail — flagging it so the record is current; see git log / README for
> specifics of that stretch.

> **2026-06-13 — learning-the-core (Layers 1–2), browser/fingerprint hardening, and a big dead-code cleanup.**
> - **Element fingerprints + browser guardrails + readiness retry (DONE):** affordances carry a durable
>   `elementFp {role,name,near}` (role+name+content-anchor; survives redesigns; `resolveByFingerprint` is
>   layered/deterministic). Browser guardrails: live-session ceiling (`WEBNAV_MAX_SESSIONS`=16), per-host
>   throttle (`WEBNAV_HOST_INTERVAL_MS`=1000), reap force-close, non-hydration detection. `dev sessions reap`
>   now UNLINKS the on-disk `.session` file (was a silent no-op for dead sessions). Specs:
>   `2026-06-13-element-fingerprint-design.md`, `2026-06-13-browser-guardrails-design.md`.
> - **Smooth learning via `graph-analyse --draft` (DONE):** folds a recording into a SELF-VERIFIED
>   `{node,states,edges}` graph-edit spec (absolute URLs, uniqueness fingerprints, resolvable edges, login
>   wired, cross-link mesh so modules aren't dead-ends). Spec `2026-06-13-graph-analyse-draft-design.md`.
>   `dev node-clear` (empty a node to re-learn) + `dev node-rm` (delete a node) added — re-learn ENTIRELY
>   through webnav, never raw sqlite.
> - **Learning the CORE (Layers 1–2 DONE; spec `2026-06-13-learning-the-core-design.md`):** the draft now
>   captures the full in-page affordance REPERTOIRE (mutate/reveal/input + needsClassification, not just
>   navigate; verify-before-emit drops ambiguous icon-glyph noise) AND a declared domain SHADOW on each
>   state (table columns/filters/createsEntity/sub-tabs — evidence, never interpretation, #5a-bounded).
>   `declaredShadow` persisted (idempotent migration) + carried through the contract (`MapPack`). Layer 3
>   (workflows) OUT OF SCOPE, Layer 4 (couplings) PARKED.
> - **Verified live on a Haiku-built OrangeHRM map:** a Haiku agent LEARNED the full site one-shot (17
>   states, rich interiors) AND USED the map to walk login→Recruitment-Candidates (`status: done`, 1 ref
>   resume at a drifted fork). Learn AND use both proven.
> - **Dead-code cleanup (DONE):** deleted the parked GitHub-recall / internet-graph / goals engine —
>   `router/{live,recall-via-map,router,extractors,locate}`, `graph/{route,hop,export,interior}`,
>   `explorer/{github-skeleton,explorer}`, `goals/find-battle-tested-repos`, the `Goal` type + store goal
>   CRUD + goals table, and their 18 tests. All were reachable from NO live verb (the recall/route/hop/
>   locate/list-goals CLI verbs were removed 2026-06-13). Fixed `list` (it never read the store → always
>   empty; now shows sites + state counts); removed `describe` (redundant with graph-show/outline). The v1
>   proof-of-engine lives in git history.
> - **npm:** package renamed `@dikshanty94/webnav`.

> **2026-06-12 (later) — usage-weights machinery moved OUT (to webnav-site).** Edge
> `reliability`/`success_count`/`fail_count`/`last_verified`/`confidence`, node-edge `weight`,
> `recordOutcome`/`decayConfidence`, and the reliability-weighted path cost are REMOVED — the
> open-source map stores declared/static data + the self-heal `selector_cache` only (principle
> #4 rewritten in CLAUDE.md). Usage-learned weighting is a hosted feature: webnav-site will
> aggregate walk outcomes across users and fold weights into the served map's `cost` (design:
> webnav-site `docs/superpowers/specs/2026-06-12-usage-weights-design.md`). Contract note: the
> next `@dikshanty94/webnav` release drops those fields from `Affordance`/`Edge`/`NodeEdge`.

> **2026-06-12 (later) — PR #1 restored + walk-resume input fix.** PR #1 (the MCP/repositioning
> work below) was accidentally reverted on GitHub and has been reapplied (`git revert` of the
> revert; re-verified: tests, build, MCP stdio smoke). Also fixed: `walk-resume` now accepts
> repeated `--input slot=value`, so one-off inputs from the original `walk` survive a pause
> (same flags-over-stored-creds overlay as `walk`; still never persisted).

> **2026-06-12 — MCP wrapper (Phase 5 DONE) + saucedemo-only repositioning + docs sync.**
> - **`webnav mcp` (Phase 5 DONE):** every verb is now served as an MCP tool over stdio
>   (`{"command":"webnav","args":["mcp"]}` in any MCP client). A THIN layer: tools are
>   GENERATED from the cli-spec registry and every call executes the real CLI, so the two
>   surfaces cannot drift. Excludes long-running modes (`dashboard`, `mcp` itself).
>   Unit-tested (tool schemas, argv round-trip through the real parser, JSON-RPC handling,
>   exit-code mapping 2=error/3=empty-ok) + smoke-verified live over stdio.
> - **Repositioning (settled with user):** this repo advertises ONLY the saucedemo-seeded
>   default + the record-your-own-site flow (automation testing, internal tools, repeated
>   agent workflows). The GitHub `recall` skeleton + internet-graph seed are programmatic/
>   test fixtures (`seedGitHubAndGraph`), deliberately NOT seeded and NOT advertised. The
>   website/hosted shared-map route moved to the separate `webnav-site` repo and is no
>   longer advertised here (the thin client — `login`, `walk --hosted`, `hosted.ts` —
>   remains in-tree, documented only via `--help`).
> - **`dev effects --session S`:** dumps a record session's RAW action-effects (full
>   before/after snapshots) — closes the "raw stays for the agent isn't CLI-reachable"
>   follow-up from 2026-06-08.
> - **Spec/code fix:** BROWSER_FLAGS help said headless-default; the code (and tests) are
>   headed-by-default with `--headless` opt-out. Spec now matches the code, and documents
>   `--headless`.
> - **Docs sync:** README (verb table led by walk/record flows, source map refreshed,
>   website/hosted sections removed), this file (post-site-split reality), CLAUDE.md
>   (status snapshot + plan checkmarks).
> - **Benchmark re-pointed at saucedemo:** the multi-page navigation benchmark
>   (`2026-06-03-navigation-benchmark-design.md`) targeted GitHub, which contradicts the
>   saucedemo-only positioning; it should run as `walk` vs raw-browser on saucedemo flows.
>   NOT runnable in a sandboxed/cloud session (needs playwright-cli + open network) — run
>   it from a normal dev machine.

> **2026-06-10 — Full saucedemo map + R5 resume loop (DONE).**
> - **Complete site mapped:** exhaustively explored saucedemo via webnav (Haiku subagent) and persisted the FULL graph to `webnav.db` — 7 states incl. the previously-missing `product-detail` and `checkout-complete`, About→external `saucelabs.com`, cart Remove, both checkout Cancels. `dev outline` confirms 0 dead-ends / 0 orphans / 1 external exit.
> - **Navigation test cases:** `tests/router/saucedemo-routes.test.ts` — 8 `findPath` cases over the full cyclic map (log-in, full checkout, product-detail, product→cart, logout/cancel back-edges, post-order return, reachability). Proves the stored graph SUPPORTS navigation.
> - **R5 resume loop DONE:** fixed the bug where `classify: safe` on a commit edge re-escalated forever; now a safe verdict FIRES the commit (the only path that does, on explicit agent classification — #2 intact). New `runWalkLiveComplete` walks login→…→checkout-overview, classifies Finish safe, and reaches checkout-complete. Verified LIVE end-to-end; the other two live walks still halt-at-commit / no-escalation. 3 new unit cases + a gated live e2e.
> - **Graph viewer:** deprioritised (per review — the agent never reads it; `dev outline`/`mermaid`/`graph-show` are the right verification tools). The React-Flow viewer works (ELK-routed, dark mode persisted, single orthogonal edge style) but is treated as good-enough, not the focus.



> **2026-06-09 — Affordance-primary model + working saucedemo walk + readable graph (DONE; on `feat/affordance-model`).**
> `State.affordances` is now `Affordance[]` (typed: `navigate`/`reveal`/`mutate`/`input`, + `commit`, `toState`, `addressableUrl`, `children`, `needs`, `acceptsInput`). Affordances are the SOURCE OF TRUTH; `store.edgesFrom`/`allEdges` PROJECT navigate/reveal affordances into the existing `Edge` shape so the router/walk are unchanged; `store.interiorEdges` adds `viaAffordance` + dangling stubs for the viewer.
> - **Walk works perfectly, verified live:** the saucedemo walk now COMPLETES login→inventory→cart→checkout-info→checkout-overview and halts before the Finish commit (no escalation). add-to-cart is a same-page `mutate` (not a gate); the cart is reached via a tier-1 `addressableUrl` jump (the cart icon has no stable name). `walk.ts` gained an addressable-jump branch (`browser.goto`). Both gated live e2es rewritten to assert this and pass.
> - **Graph is human-readable, visually verified** (playwright-cli headless): nodes render the typed repertoire as a categorized vertical list (NAVIGATE/REVEAL/MUTATE/INPUT), edges leave the SPECIFIC affordance row's handle, the burger menu is a collapsible `reveal` whose children nest inside the node, the Finish commit shows a "commit · never auto-fired" badge, mutate/input rows are muted with no handle, and one "? unexplored" stub shows the About exit. Floating edges (border-intersection + direction-invariant reciprocal bowing + outside self-loops) ported from `Mnet/process-map`; `BowEdge`/`RoutedEdge` removed.
> - Spec `docs/superpowers/specs/2026-06-09-affordance-model-design.md`, plan `docs/superpowers/plans/2026-06-09-affordance-model.md`.

**Updated:** 2026-06-08 · **Branch:** `main` · **Tests:** 322 unit pass + 9 gated live e2e (skipped without `WEBNAV_LIVE=1`) · **Build:** green (incl. web/)

> This is the canonical "where are we / what's next / how to run" doc. Keep it
> current. CLAUDE.md = settled design & principles; this = the live checklist.
> Design docs live in `docs/superpowers/specs/`, the v1 plan in `docs/superpowers/plans/`.

---

## What webnav is (one line)

A zero-LLM web-navigation **memory + map** (a navigation memory for AI agents):
an agent shells out to the `webnav` CLI to navigate sites reliably, recall routes,
search the web, and get back compact **evidence** — the agent does all judgment.
See CLAUDE.md for the full mental model and the 6+ settled principles (esp. #5a:
webnav contains NO LLM; never evades bot-walls).

## How to run

```
npm install          # better-sqlite3 native build; Node 18+
npm link             # install `webnav` on PATH (a peer of playwright-cli; runs src via tsx — NO build)
webnav --help        # the tool menu (every verb + when-to-use)
npm test             # vitest unit + gated e2e (skipped without WEBNAV_LIVE=1)
npm run build        # tsc -> dist/ (only for the dist build; the webnav CLI runs src directly)
WEBNAV_LIVE=1 npx vitest run tests/e2e   # the gated live tests (need a browser + network)
```
**`webnav` is an installed CLI** (`bin/webnav` launcher → `tsx src/cli.ts`; `npm link` puts it on PATH). It runs current source, so code changes need NO rebuild. Invoke as `webnav <verb>` everywhere (like `playwright-cli`).
Requires `playwright-cli` on PATH (installed at `/usr/local/bin/playwright-cli`).
A file-backed `webnav.db` (SQLite, gitignored) persists the map across runs.

## The verbs (generic primitives over the map; self-describing CLI)

**Consumer verbs** (the `webnav --help` menu):

| Verb | What it does |
|---|---|
| `webnav walk --start X --goal Y [--input k=v] [--hosted]` | autopilot a multi-step route over a built map; pauses at genuine forks (`needs-navigation`/`needs-classification`) |
| `webnav walk-resume <session> --ref e42 \| --classify safe` | answer a paused walk's fork; `--classify safe` fires a commit and continues (R5) |
| `webnav creds set\|list\|rm <site> [k=v…]` | local credential store (`~/.webnav/credentials.json`, chmod 600; never in the map) |
| `webnav read <url> [--raw]` | open a URL → distilled content (the "go read this page" primitive) |
| `webnav search "<query>" [--top N]` | multi-provider open-web search → visit top-N → extract evidence |
| `webnav eval <url> "<js>"` | open a URL, run a JS expression → just the value (cheap, targeted extraction vs a full snapshot) |
| `webnav network <url>` | open a URL → the network/API calls the page made (the JSON behind the DOM) |
| `webnav go-back \| reload` | step within the current `-s=<session>` browser |
| `webnav login <key>` | save a hosted-route API key (un-advertised; the hosted service lives in the separate `webnav-site` repo) |
| `webnav use navigate <url> --session S` | open a URL in session S's browser (records a landing observation if S is recording) |
| `webnav use snapshot --session S` | the current page's snapshot + refs (the agent's "look"; never records) |
| `webnav use click <ref> --session S` | click a ref (from snapshot); records the before/after action-effect if recording |
| `webnav use type <ref> <text> --session S` | type into a field by ref; records the action-effect if recording |

`--help` is grouped **Find / Read / Navigate** (playwright-style), and each verb's per-verb help teaches data-flow (where its inputs come from / outputs go).

**Dev/teach verbs** (`webnav dev <verb>`, out of the consumer menu): `list` (sites you have maps for + state counts), `node-add`, `edge-add`, `node-clear` (empty a node to re-learn), `node-rm` (delete a node), `capture`, **`record-start`**, **`record-stop`**, **`graph-analyse [--draft]`**, **`graph-edit`**, **`graph-show`**, **`effects`** (the agent-driven site-mapping flow — see below), plus `export-map` (a site's map pack as JSON), `outline` / `mermaid` (text views of an interior), `dashboard` (local operator UI: sites + JSON map + credentials), and `mcp` (serve all verbs as MCP tools over stdio).

Two CLI categories: **`use`** (drive the browser + query the map — the consumer verbs) and **`dev`** (author the map — the teach + mapping verbs). Both dispatchers re-parse the sub-verb; bare consumer verbs still work.

Exit codes: 0 ok · 2 error (→ stderr + `--help` hint) · 3 ran-fine-but-empty/failed.

### Interactive recording verbs (DONE, 2026-06-08)

Four `use` verbs give the agent **hands** to drive a live page across CLI calls and
record action-effects: `use navigate <url>` (open + landing observation),
`use snapshot` (read the page + refs; never records), `use click <ref>` /
`use type <ref> <text>` (perform + record before/after via `runActionRecorded`,
which now supports type/fill as well as click). One `--session` id = the
persistent `-s=` browser (survives across CLI processes) + the record buffer;
recording is conditional on an active session; verbs never close the browser.
`navigate` uses `open` (creates+navigates; `goto` fails on a fresh session).
This completes the agent loop: `dev record-start` → navigate/snapshot/click/type
→ `dev record-stop` → `dev graph-analyse` → `dev graph-edit`. Verified live on
saucedemo via the CLI (login `navigated:true`; add-to-cart `navigated:false`).
Spec/plan: `docs/superpowers/specs/2026-06-08-interactive-recording-verbs-design.md`,
`docs/superpowers/plans/2026-06-08-interactive-recording-verbs.md`.

### Affordance recording — action-effects (DONE, 2026-06-08)

webnav now records observed **action-effects** instead of inventing a state-node
per in-page change: each recorded step is `{ fromUrl, fromSnapshot, action, toUrl,
toSnapshot, navigated, diff }` (full before/after kept raw; diff + `navigated` are
mechanical derivations — `diffSnapshots`/`didNavigate`). In-page mutations
(saucedemo add-to-cart → button flips to "Remove", URL unchanged) record with
`navigated:false` — never a new node, killing the page=state ambiguity that
blocked the walk. `graph-analyse` is rebuilt **structure-neutral**: it returns raw
observations grouped by host (the page the action was taken on — `fromUrl`), with
NO clustering / states / edges. The calling AGENT decides the site's structure and
writes it via `graph-edit` (unchanged); webnav stays zero-LLM (the LLM is the
caller). `runActionRecorded` captures before/after around an agent action.
Verified live on saucedemo (add-to-cart → `navigated:false` + "Remove" in the
diff). Note: the page-only `runSnapshotRecorded` path still exists but
`graph-analyse` now reads action-effects (`actionEffects()`), so recording should
go through `runActionRecorded`. **Known follow-up:** the full raw before/after
snapshots ARE persisted (and readable in-process via `actionEffects()`), but
`graph-analyse` only emits a readable diff *summary* — there's no CLI verb yet
that hands the agent the raw snapshots, so the "raw stays for the agent" promise
isn't CLI-reachable end-to-end. Spec/plan:
`docs/superpowers/specs/2026-06-08-affordance-recording-design.md`,
`docs/superpowers/plans/2026-06-08-affordance-recording.md`.

### Agent-driven site mapping (DONE, 2026-06-05)

An agent explores an unknown site (driving via webnav's `use` browser primitives,
which record each page) and webnav builds a per-site navigation skeleton it can
later `recall`/`route` over — the "build the map from observed/declared data"
thesis applied to map-building. Flow: `dev record-start` opens a capture session →
agent browses (each page → url + structural fingerprint + declared links buffered
in SQLite via `runSnapshotRecorded`) → `dev record-stop` → `dev graph-analyse
<session>` mechanically clusters pages into state-TYPES per site + cross-site edges
(**zero-LLM, data not prose** — machine labels only; the agent names/validates) →
`dev graph-edit --node --graph <json>` upserts the agent's validated graph (creates
the node if new; fork edges that need user input are marked `unclassified` +
`[needs-input: why]`) → `dev graph-show --node` reads it back. The exploration loop
+ all judgment lives in the AGENT (#5a); webnav stays mechanical. Verified live
against GitHub. Spec/plan:
`docs/superpowers/specs/2026-06-04-agent-driven-site-mapping-design.md`,
`docs/superpowers/plans/2026-06-04-agent-driven-site-mapping.md`.

**Subagent model (CLAUDE.md):** subagents that USE or TEST webnav run on Haiku
(dogfooding the cost thesis); all other work uses the best model for the task.

### CLI framing + browser primitives (DONE, 2026-06-03)

webnav's `--help` is now framed like playwright-cli's: consumer verbs grouped by
purpose (**Find / Read / Navigate**) and per-verb help teaches **data-flow** (an
arg names where it comes from / where output goes — e.g. recall's goal-id is "from
`list-goals`", read's url is "from `locate`", playwright's `<ref>=from snapshot`
move). Added Navigate primitives built ON playwright-cli: `eval <url> "<js>"` (run
JS → just the value; clean-parsed out of playwright-cli's wrapper — the cheap
targeted-extraction path vs a 53k-token snapshot), `network <url>` (the API/JSON
calls behind the DOM), and `go-back`/`reload`. Verified live (eval returns the
psf/requests page title cleanly). Spec/plan:
`docs/superpowers/specs/2026-06-03-cli-framing-and-browser-primitives-design.md`,
`docs/superpowers/plans/2026-06-03-cli-framing-and-browser-primitives.md`.

### Generic verb re-grounding (DONE, 2026-06-03)

webnav's verbs are now **generic operations over map DATA** — no website baked into a verb (fixing the old `recall` = "navigate GitHub" coupling that made agents thrash a trivial "how many open issues" task). Highlights: added `read <url>` (the missing "open a page and read it" primitive — distilled content via `extractContent`/`classifyReadiness`, escalates on bot-walls, never evades); `recall <goal-id> "<query>"` is data-driven (explicit goal id, deterministic lookup, site-bound Goal record carries `site`/`entry`/`extractor`, named extractor registry) — GitHub-repos is the one seeded goal, a 2nd site is data-only; admin verbs moved under `webnav dev`; `list-goals` for discovery. Verified live (read returns "Issues 145" off the psf/requests page; recall still navigates GitHub end-to-end). Spec/plan: `docs/superpowers/specs/2026-06-02-generic-verb-regrounding-design.md`, `docs/superpowers/plans/2026-06-02-generic-verb-regrounding.md`.

## Inspecting the map

> The React-Flow web viewer left this repo with the 2026-06-10 site split (it lives in
> `webnav-site` now). In-repo inspection is text-first — the agent never read the UI anyway:

- `webnav dev outline <site>` — top-to-bottom states + typed affordances + completeness
  cues (unexplored exits, dead-ends, orphans).
- `webnav dev mermaid <site>` — a Mermaid stateDiagram; paste into GitHub/mermaid.live.
- `webnav dev graph-show --node <site>` / `webnav dev export-map <site>` — raw JSON.
- `webnav dev dashboard` — a local operator UI (localhost only) over `webnav.db` +
  `~/.webnav/credentials.json`: per-site maps + credential management.

DB facts that still hold: the DB is the **single source of truth** for interiors; the
default seed writes ONLY saucedemo (`seedGraph` → `ensureSeeded`; GitHub + the internet
graph are opt-in **programmatic/test fixtures** via `seedGitHubAndGraph` — a recall/route
against an unseeded map returns `failed`/empty). States carry a `node_id` column.
`MapStore` implements the `IMapStore` interface — the swappable seam the hosted backend
uses. Spec/plan: `docs/superpowers/specs/2026-06-02-live-graph-viewer-design.md`.

## R1/R1.1/Nav — benchmarks (ALL RUN)

`bench/` holds a re-runnable A/B benchmark: agent+webnav (CLI only) vs
agent+plain-search (WebSearch+WebFetch), scored by an anonymized judge against
gold answers (`bench/tasks.yml`, loader `bench/load.ts`, recipe in
`bench/README.md`, reports in `bench/results/`).

- **R1 (`2026-06-02.md`, the OLD GitHub-coupled CLI):** quality webnav 3 / baseline 1 /
  tie 8; webnav used MORE agent tokens (median +6k). Honest negative — the naive
  token-savings thesis did NOT hold on general info-seeking.
- **R1.1 (`2026-06-03-r1.1.md`, 3-arm, re-grounded CLI):** **webnav tied for best
  quality 9/10** (with raw-browser; baseline 7/10), never thrashed, swept the
  bot-walled category, and beat the API's subtly-wrong `open_issues_count`. Tokens
  ~equal across arms (~19–22k; every task forces a real fetch). webnav's proven edge
  is QUALITY on data search/APIs get wrong or can't reach — and honest failure on walls.
- **Navigation benchmark (`2026-06-13-nav.md`, saucedemo walk flows, RUN 2026-06-13):**
  quality TIED A 4/4 vs raw-browser C 4/4; **reliability separated** (A 3 clean/1
  recovered vs C 1 clean/3 recovered — saucedemo's session-drop trap snared raw driving
  in 3/4 tasks). KEY finding: Sonnet agents mostly ignored `walk` for manual `use`
  driving; the one walk-led run was the benchmark's cheapest/cleanest (9 tool calls,
  68s). Orchestrator-measured walk: login→checkout-overview in **4 agent-visible CLI
  calls** (form auto-filled) vs 16–22 manual actions. Follow-up filed: **R5.1
  bare-continue resume** (no "gate satisfied, continue" answer kind exists; agent must
  re-answer with a ref on icon-only elements). Tasks: `bench/tasks-nav.yml`.

## DONE (merged to main, verified)

- **v1 engine (Tasks 0–13):** snapshot parser, playwright-cli adapter (call-counted), SQLite MapStore, deterministic resolve/replay (commit-point safe), explorer, recall→evidence, goals, CLI.
- **Memory loop (M1–M3):** Router→MapStore→Explorer; skeleton built once, persisted, never re-explored (proven by reopen-from-disk test).
- **Cost thesis:** evidence bundle reports `tokens_saved`; verified live (~65k saved on a GitHub recall).
- **Multi-step walk (W1–W2):** `walkRoute` async, per-step predict-vs-observe, escalate on drift/commit. Verified live on saucedemo (login → inventory → correct escalation).
- **Research (R2/R3/R4):** readiness/interstitial detection; content extraction; multi-provider search. R4 verified live.
- **Phase 1:** CLI hardening (clig.dev).
- **Phase 2 G1–G3:** internet graph + `route`/`hop`.
- **Graph-viz:** `graph`/`node-add`/`edge-add` + the live xyflow viewer (below).

### Graph viewer — xyflow (DONE, 2026-06-06)

The live graph viewer is now a `web/` Vite + React + **@xyflow/react** app laid
out by **elkjs**, served as static `web/dist/` by the existing read-only Node
server (`npm run dev` → http://127.0.0.1:7777; `npm run dev:web` for HMR).
Cluster view → click a site → drill into its interior skeleton; fork
(`needs-input`) edges are dashed/orange. The Cytoscape viewer + the
`webnav graph --html` export were **removed**. The server stays read-only (live
editing is a future increment). `web/` is an **isolated package** — React/xyflow/
elk are NOT root deps. The riskiest logic (elk `layout.ts`, the fork-edge
predicate) is unit-tested; `serveStatic` (with a path-traversal guard) is
unit-tested; the live render was verified headless via playwright-cli (5 cluster
nodes → drill into github.com's 3-state interior + back control). Spec/plan:
`docs/superpowers/specs/2026-06-05-xyflow-graph-viewer-design.md`,
`docs/superpowers/plans/2026-06-05-xyflow-graph-viewer.md`.

### Graph quality + viewer — affordances, core path, node hygiene (DONE, 2026-06-08)

In-page actions are now first-class **`State.affordances`** (node repertoire),
NOT self-loop edges; **`Edge.core`** marks the agent-declared main journey.
`graph-edit` authors both + node `capabilities`/`topics` (no-clobber on update);
the interior API exposes them. The **viewer** renders affordance badges inside
node boxes, emphasizes core edges (thick/blue/full-opacity) vs faded non-core,
and shows **no connection dots** (invisible handles — no-handle drops edges in
@xyflow/react v12). The duplicate/blank saucedemo is fixed: the hand-seeded
`saucedemo`/`sd:*` skeleton is **removed entirely** (deleted `saucedemo-skeleton.ts`;
walk tests rewritten onto inline fixtures; gated walk e2es re-pointed to
`www.saucedemo.com` — both pass live). Saucedemo is now a single **agent-built**
`www.saucedemo.com` node (6 states with affordances, 9 edges incl. 4 core, node
metadata set, ZERO self-loops) — verified live in the viewer (6 nodes, 9 edges,
badges shown, 0 visible dots). **Note:** a fresh clone's `webnav.db` has no
saucedemo until an agent maps it (the seed no longer ships it). Spec/plan:
`docs/superpowers/specs/2026-06-08-graph-quality-and-viewer-design.md`,
`docs/superpowers/plans/2026-06-08-graph-quality-and-viewer.md`.

### Saucedemo affordance re-seed + walk affordance-pause (DONE, 2026-06-08)

Saucedemo is re-seeded in the **affordance model** (page-states + navigation edges
only; add-to-cart is an in-page affordance, NOT a state — the old page=state
bundled `inventory→cart` edge is retired; `exploreSaucedemo` clears `sd:*` edges
on seed). New edge field **`requiresAffordances: string[]`** (declared data) lets a
navigation edge declare in-page actions that must be fired first. `walkRoute`
**pauses** (`needs-navigation` listing the affordances) before traversing a gated
edge — for ANY gated edge en route, not just the first — and the agent fires them
then resumes; ungated edges traverse deterministically (autopilot preserved — see
the **walk vs use** note in CLAUDE.md). `graph-edit` accepts `requiresAffordances`
so agent-built graphs can gate edges too. Verified live: the saucedemo walk logs
in, reaches inventory, and pauses for the add-to-cart affordance. This **completes
the interactive walk** (engine + verbs landed earlier; this finishes the saucedemo
demo on one consistent model). Spec/plan:
`docs/superpowers/specs/2026-06-08-saucedemo-affordance-reseed-walk-design.md`,
`docs/superpowers/plans/2026-06-08-saucedemo-affordance-reseed-walk.md`. (Walk
engine + verbs: `docs/superpowers/specs/2026-06-06-interactive-walk-design.md`.)

## ⚠️ PENDING — start here next session

**Ranked next-work backlog (2026-07-09** — grounded in `bench/BENCHMARK.md`'s finding
that the dominant lever is walk ergonomics/reliability-under-load, not the core idea;
saucedemo S2: walk 6 vs 18 calls, 3/3 vs 2/3 reached — but agents ABANDONED the walk
under load on S3, collapsing into manual driving):

1. **walk-reliability (DO FIRST):** make `walk` survive real-site conditions so agents
   stop abandoning it mid-route. (a) Fix the OrangeHRM-class login-walk failure (walk
   can't complete though manual `use` works — open engine bug); (b) R5.1 **bare-continue**
   resume: `walk-resume <id> --continue` for "gate satisfied, just go" (today only
   `--ref`/`--classify`; agents stumble re-answering satisfied gates on icon-only
   elements); (c) readiness-retry budget under load. Files: `src/router/walk.ts`,
   `walk-session.ts`, `src/protocol.ts`/`contract.ts` (published types — additive only),
   `src/cli.ts`. Don't regress the proven saucedemo login→checkout walk.
2. **agent-map-pipeline:** prove roadmap Steps 2–3 end-to-end for AGENT sessions:
   `use session` (clicks carry elementFp) → `graph-analyse --draft` → `graph-edit` →
   `walk` completes on the drafted map. Verify `draftFromEffects` handles agent-session
   effects (navigate steps have `action:null` + `fromSnapshot:''`). Add an e2e test.
3. **one-command-map:** `dev map-site --session <recorded>` = analyse → draft →
   self-verify → apply → summary (exploration stays external — zero-LLM). Draft
   `_warning`s must block silent apply; node-id collision refuses without `--replace`.
4. **map-documentation (user's idea):** generate site documentation from video frames +
   steps (external `claude -p` Sonnet, reuse `extractFrames` from review.ts) and store
   it IN the map (additive `nodes.documentation` column) + dashboard Sites render +
   `export-map`. Turns the map from a route table into a documented understanding.
5. **session-hygiene:** `use eval --session` must REATTACH (today spawns a new
   `browse-<ts>` session — too long → macOS socket EINVAL — and ignores `--session`);
   reap/ceiling counting must reflect reality (ghost sessions hit the 16 ceiling);
   short auto-generated session names everywhere (≤ ~14 chars).

**QUEUED (deferred at user's request, 2026-07-09):** a full project-review deliverable —
`PROJECT_UNDERSTANDING.md` (what we're building, competitors, where we stand, core
functionality + refinements) **plus 5 standalone `PLAN-<slug>.md` files** (one per
backlog item above; each: goal / exact files / step-by-step order / edge cases a weaker
model would miss / user-verifiable acceptance criteria — written so a less capable model
executes without questions). The analysis is done (this backlog is its output); the
user will come back for the documents.

Older items, resolved or parked:

- ~~**Saucedemo navigation benchmark**~~ ✅ **RUN (2026-06-13):** quality tied with
   raw-browser; reliability separated (A 3 clean/1 recovered vs C 1/3); walk-led run was
   cheapest+cleanest; walk = 4 agent CLI calls login→checkout-overview vs 16–22 manual.
   Report: `bench/results/2026-06-13-nav.md`. Full analysis: `bench/BENCHMARK.md`.
- ~~**Interactive agent session + capture loop**~~ ✅ **DONE (2026-07-09):** `use session`
   (one long-lived process: JSON-lines stdin/stdout, video works, no leaked windows) and
   `dev capture-loop` (explore → structured Sonnet review → converge on zero capture
   gaps). Specs: `2026-07-09-interactive-agent-session-design.md`,
   `2026-07-09-capture-improvement-loop-design.md`.
- ~~**One-command map (old phrasing)**~~ → superseded by backlog #3 above.
- ~~**R5 — resume loop**~~ ✅ **DONE (2026-06-10):** `classify: safe` fires a commit and the walk continues to completion (verified live, login→…→checkout-complete). Default still hard-halts at commits (#2).
- ~~**Phase 5 — MCP wrapper**~~ ✅ **DONE (2026-06-12):** `webnav mcp` serves every verb as MCP tools over stdio; generated from cli-spec; calls run the real CLI.
- **PARKED — multi-site graph features** (G4 co-use weight learning, auto-learn nodes
   from usage, richer GitHub signals): the internet graph + GitHub recall are not the
   advertised product surface (2026-06-12 repositioning) — revisit only if/when that
   surface comes back.

## Honest known limitations (not bugs — design/ecosystem reality)

- **Open-web search quality is capped** by which engines tolerate a real browser (Marginalia/Wiby work; Google/Bing/DuckDuckGo bot-wall). We do NOT evade — we detect + escalate. Better coverage needs official search APIs (keys) — see the doors layer.
- **GitHub run-2 isn't fewer page-loads** (search + each detail are irreducible fresh re-reads); the real saving is agent tokens, every run.
- **Bot-walled sites are reported as blocked, never bypassed** (principle: no detection evasion).

## Future architecture (designed, NOT built — see specs)

- **Sanctioned-doors layer:** per-node access terms `open|api-key|cash|attention-loop`; route to the cheapest *sanctioned* door; search APIs (Google/Bing/Brave) as first-class providers when a key is configured. Detect-and-escalate at walls/tolls, never evade.
- **Attention-return economics** (`docs/superpowers/specs/2026-05-31-attention-return-economics.md`) — PARKED until testable (pay-per-crawl 402 is private-beta; real payout needs an affiliate account). The thesis is real & live in the market (Cloudflare pay-per-crawl; OpenAI Ads Manager; Shopify agentic storefronts; affiliate attribution) but not end-to-end testable for us yet. Revisit trigger documented in that spec.

## Working conventions (for the next session)

- **Per-increment worktree:** build each feature on its own branch in `.worktrees/<name>`, TDD, merge to `main` when green, remove the worktree. (`worktree.baseRef=head` is set so worktrees branch from local HEAD — no remote configured.)
- **Subagents can't run Bash here** — pattern used all session: the implementer subagent WRITES code+tests and reports; the main session runs vitest/build/commit.
- **Dogfood + "failures are features":** use webnav on real problems; every failure becomes a feature to fix (this caught the open/goto bug, relative-link bug, license-noise bug, search chrome-leak, render-race).
- **`dontAsk` permission mode** is set in `.claude/settings.local.json` (takes effect on a fresh session) to stop repeated allow-prompts.
- The repo is public: `github.com/lucyfuur94/webnav` (CI on push/PR to `main`). The

## Review-flow audit (2026-07-10, structure-inference)

Task 14 — audited `webnav dev review` (capture-completeness gate) against the draft-engine
rewrite (Tasks 7–10: observation-based inference, aliases, shell, provisional states, folded
affordances; deleted `pathSlug`/`ID_SEG`/`stablePathKey`, `RECORD_COUNT_RE`/recordCount,
`ShadowOpts`/subtab-container, `linkPageCount`/`sidebarCut`, no numeric-suffix naming). No code
was stale; no fix applied.

1. **Prompt/rubric references deleted concepts? NO.** `src/recorder/review.ts` (prompt builder
   `buildReviewPrompt` L69–100, rubric `DEFAULT_INSTRUCTIONS` L28–39, `STRUCTURED_TAIL` L45–51)
   and the `review` handler in `src/cli.ts` L667–701 build the prompt purely from
   `RecordStore.actionEffects()` (raw per-step `fromUrl/toUrl/action/navigated`, `src/cli.ts`
   L680–684) + extracted video frames — zero references to page unions, stable-path keys,
   `-2`-suffix names, or record counts. Grepped `src/recorder/review.ts` for
   `union|stablepath|pagekey|record.count` — no hits (the one `-2` match, L144, is ffmpeg's
   `scale=800:-2` aspect-ratio flag, unrelated). The review flow sits entirely upstream of
   `draftFromEffects` in the pipeline (steps → review → **then** graph-analyse/draft), so it
   never touches draft's internal identity model at all. Confirmed against Tasks 7–10 reports
   (`.superpowers/sdd/task-{7,8,9,10}-report.md`) for the exact deleted-symbol list.

2. **Approval gate keys correctly through `record-rename`? YES.**
   `RecordStore.renameSession` (`src/mapstore/record.ts` L148–157) updates
   `record_sessions.session_id` (which carries the `review` column written by `setReview`,
   L82–84) and `record_observations.session_id` in one transaction, both keyed on the same
   `session_id` string. `reviewOf` (L85–89) and the graph-analyse gate (`src/cli.ts` L604–617,
   `store.reviewOf(id)`) read that same column by the same key. Post-rename, `reviewOf(to)`
   returns the verdict that was set under `from` — no separate id space, no stale reference.
   `renameSession` also refuses when `to` already exists (L151), so a rename can't silently
   merge/clobber another session's verdict.

3. **Should review also gate on `receipt.requests`/provisional states? NO — confirmed.**
   Review verifies **capture completeness**: did the recorder log every on-screen interaction
   the video shows (`DEFAULT_INSTRUCTIONS` L28–36 — "CAPTURE GAPS: visible changes … with NO
   captured step"). It operates on raw `actionEffects`, before `draftFromEffects` ever runs.
   `provisional`/`receipt.requests` are the **analyse-side refine loop** — draft's structural
   confidence that a state's identity/fingerprint needs another visit to firm up (Task 7's
   `provisional` field, propagated from `templateCore`; surfaced as `requests` in
   `graph-analyse --draft` output, `src/cli.ts` L619–628). These are two independent quality
   gates at two different pipeline stages, on different questions ("did we record everything
   the human/agent did" vs "is our structural inference confident yet"). Conflating them would
   block graph-building on structural confidence (which needs MORE draft runs/visits, not a
   better video review) — the approval gate would then never pass on a legitimately
   single-visit-but-fully-captured session, which is not what it's for. Kept separate; no
   change.

4. **Settle-loop timing vs review's step↔frame matching: no wrong-verdict risk found.**
   The scripted `use session navigate` path (`src/recorder/agent-session.ts` L124–146) settles
   up to `3 × 700ms = 2.1s` (L133–136) reading the snapshot/URL, and stamps `capturedAt` via
   `RecordStore.appendActionEffect`'s default `nowMs = Date.now()` (`src/mapstore/record.ts`
   L178) called AFTER that loop (L139) — i.e. `capturedAt` is already the POST-settle
   (post-render) moment, the same moment a scene-change video frame would show the page
   arrived. The human-recorder path (`src/recorder/live-record.ts` L209) passes an explicit
   `p.ev.t`, the real DOM event timestamp from `live.ts` L88 — no settle delay in that path at
   all. Either way, the review's own tolerance window is `±5s` (`STRUCTURED_TAIL`,
   `src/recorder/review.ts` L50) — comfortably absorbs the ≤2.1s settle window with margin to
   spare. No misalignment found; no fix needed.

**Regression:** `npx vitest run tests/mapstore/record.test.ts` → 14/14 passed (renameSession +
setReview/reviewOf coverage). Full `npm test` also run clean before commit. No code changes —
audit-only, per the task's own expected conclusion.
  website/hosted backend is the separate `webnav-site` repo.
