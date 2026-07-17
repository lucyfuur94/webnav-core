# In-browser extension — product direction + de-risking spike (2026-07-18)

> **Direction doc, not a build spec.** Written after a strategy discussion (2026-07-17/18).
> Commits nothing. The goal-1 completion branch and the paused the analytics SPA run are untouched.
> The one thing this doc asks for is a cheap SPIKE that answers "is this real?" before any
> product commitment. Nothing here changes settled architecture until the spike passes.

## The idea (user's, in plain terms)

A browser extension: click it, a sidebar opens, Claude (on the user's own subscription) can see
the page, click, type — like Anthropic's Claude Chrome extension. The difference that makes it
**webnav** and not a Claude-extension clone:

- **It records** what happens, into webnav's map.
- **The second time** the same task comes up, Claude doesn't re-reason over screenshots — it
  recalls the stored graph and does it fast. First run feels like Claude; every run after feels
  instant. This is webnav's core thesis (recall-don't-re-explore) with a native front door.
- **User stays in control**: watches the agent work, can grab the page for a quick manual input,
  hands back — the handoff Claude's extension already does well.
- Scoped to **its own tab group** (mirroring Claude's extension), so "the agent drives HERE, you
  work THERE" is legible and safe — an agent loose across all tabs is the scary, easy-to-break
  version.

## Why this was previously (wrongly) considered blocked

Two conflations we made before, corrected:

1. **"Extensions can't record reliably."** FALSE as stated. What actually failed
   (`[[webnav-recorder-capture-source]]`) was a Chrome extension doing a **DOM walk** — reading
   raw HTML — which produced 0 edges and junk identity. The lesson was *"DOM-walk is the wrong
   sensor,"* not *"extension is the wrong surface."* The a11y tree (below) is a different,
   correct sensor an extension can reach.
2. **"Replay/driving needs playwright-cli."** FALSE for THIS product. playwright-cli's value is
   (a) the a11y snapshot, (b) deterministic driving, (c) a HEADLESS runtime. This product is
   **user-present and visible** — headless is not a goal (it was a test-harness detail we
   over-protected, classic YAGNI). An extension driving the user's real, visible browser is
   *more* real than playwright and is the only way the watch-and-handoff UX can exist at all.
   Headless autopilot (nobody watching, 3am, server-side) is a *different, speculative* surface
   — keep playwright-cli for that and for our internal tests; it need not ship in the product.

## The actual architecture (settled thesis, restated for two producers)

The lock-in was never "playwright the tool." It was **"playwright's snapshot serialization is the
only thing that can feed the map."** The engine's real contract is tiny and format-agnostic
(verified against `src/playwright/snapshot.ts`): the whole map/inference pipeline consumes a flat
list of nodes, each `{ role, name, ref, url, depth }`, with a STABLE `ref` identity across calls.
Nothing downstream (`parseSnapshot` → the five inference axes → fingerprints → graph → walk) cares
who produced that list.

So the direction is: **demote playwright-cli from "the definition of a snapshot" to "one producer
of the snapshot format."**

- **Extension** = a producer for the user-present case (reads the browser's accessibility tree via
  `chrome.automation` / CDP `Accessibility.getFullAXTree`, emits the same `{role,name,ref,url}`
  node list), AND the visible driver + replayer with handoff.
- **playwright-cli** = a producer for the headless/test case (unchanged; stays our authoring +
  benchmark tool).
- **One engine, one map, two producers, two executors.** Replay becomes a *capability* not a
  backend: extension replays visibly with handoff; playwright-cli replays headless. Same graph.

## The ONE hard, unbugdeable risk (what the spike must answer)

Everything else is de-risked by existence proof — Anthropic's Claude extension does subscription
auth, sidebar, page-driving, the (harmless, Claude shows it too) debugger banner, and the
own-tab-group scoping, in production. Copy the pattern.

The single thing NOT proven: **can an extension-sourced accessibility snapshot feed our existing
engine and yield STABLE element identity across renders/redesigns?** Our fingerprints (role + name
+ `near` content anchor) are *designed* sensor-independent, but they're currently only ever fed
playwright's serialization. The a11y tree from CDP is the same *information*, different *shape*,
and — critically — its node handles are not playwright's `e\d+` refs. Identity stability is the
entire webnav thesis; if an in-browser snapshot can't produce durable identity, the memory doesn't
work and the product is just another Claude-extension clone.

## The spike (cheap, answers real/not-real before any commitment)

Goal: prove round-trip, NOT build the extension. A few days, throwaway.

1. From a plain Chromium + CDP (no extension packaging yet — CDP is what both playwright AND an
   extension's debugger sit on; proving it at the CDP layer proves it for both), pull
   `Accessibility.getFullAXTree` on 3–4 real pages we already have playwright snapshots for
   (saucedemo, one the analytics SPA page, an OrangeHRM page).
2. Write a thin adapter: CDP a11y tree → our `SnapNode[]` (`{role,name,ref,url,depth}`). The `ref`
   is the open question — CDP gives backendNodeIds; decide whether those, or a derived
   role+name+near fingerprint, is the stable key.
3. Feed BOTH snapshots (playwright's and the CDP-adapter's) of the SAME page through
   `parseSnapshot`-equivalent + the inference draft. **Compare the resulting maps.** Success =
   same states, same affordances, same fingerprints (or differences we can explain and close).
4. The real test: recover fingerprints from the CDP snapshot, then RESOLVE them against a
   playwright snapshot of the same page (and vice versa). If a map recorded in-browser can be
   walked headless and vice versa, identity is truly sensor-independent — the thesis holds across
   producers. If not, we learn exactly where it breaks before spending a line on product code.

Deliverable: a short findings note — "round-trips cleanly / breaks here, fixable by X / breaks
fundamentally because Y." That decides whether the extension is a real path or hand-waving.

## Product sequencing (once the spike passes)

Ladder — climb a rung only when the one below actually pinches, never preemptively:

1. **Extension** — the MVP of the WHOLE thesis: subscription Claude in a sidebar + record button +
   the second-run speedup the Claude extension can't do. Cheapest surface, most reach (rides the
   browser people already have), zero switching cost. If the "whoa, instant this time" moment
   doesn't land here, no browser fork saves it.
2. **(Dropped)** A companion desktop app to dodge the debugger banner — NOT needed; Claude's
   extension proves the banner is a non-issue for adoption.
3. **Full Chromium fork** (the Perplexity/Arc/Comet/Dia path — fork Chromium, never write an
   engine) — total control, but a maintenance TREADMILL (rebase onto Chrome's ~4-week security
   releases forever = a standing team) and a 100× harder adoption ask ("switch your whole
   browser"). Only when the extension's real ceilings (blocked pages, store policy, chrome UX we
   can't change) are demonstrably what's capping the product — with users + revenue already in
   hand. Perplexity forked AFTER product-market fit + a war chest; order matters.

The trap: forking first is seductive (removes every technical constraint at once) but front-loads
the two hardest NON-technical problems (the treadmill, the switch-my-browser ask) before proving
the one novel thing. Validate value on the cheap surface first.

## What this does NOT change (guardrails intact)

- Zero LLM inside webnav's navigation engine (#5a). The extension's Claude does the reasoning; the
  map/graph/replay stay judgment-free. The extension is a CONSUMER of webnav, like any agent.
- The a11y tree, never a DOM walk (the one hard lesson).
- Never evade access controls; the extension uses the user's own authenticated session, honestly.
- Commit points never auto-fired; handoff is the user's, not a bypass.

## Open questions for the user (not blocking the spike)

1. **Our own extension using the user's Claude subscription, or riding Anthropic's extension?**
   (Leaning: our own — we need to shape record/replay, and riding theirs means living at the mercy
   of what they expose.) The spike is agnostic to this; it tests the snapshot layer either way.
2. Does "subscription account" mean the user pastes an API key, or a real OAuth-to-Claude flow?
   (Affects onboarding friction, not the core.)
