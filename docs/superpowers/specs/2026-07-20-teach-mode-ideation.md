# Teach mode — ideation synthesis (2026-07-20)

> Status: IDEATION — seed for a design spec, nothing built. Produced by a 4-lens
> agent panel (UX, capture architecture, teaching semantics, differentiation) +
> synthesis, each lens grounded against the actual code (ingestAX/beginStep/
> record.ts seams verified to exist as claimed). Decide the 5 open questions at
> the end before writing the implementation plan.

# webnav Teach mode — synthesis

## 1. Name + pitch

**Teach** (the third panel segment: **Ask · Act · Teach**).

> *Show it once in your own tab — webnav remembers it as a named, zero-LLM route AND folds it into the shared map any agent can walk.*

The differentiator in one breath: Claude-for-Chrome teaches a *model*; Teach teaches the *map*.

## 2. The core loop (plugs into the existing pipeline — no fork)

1. **Demonstrate.** User flips to Teach; a content script reports *when/where* they click/type; the already-attached CDP debugger supplies *what* (a fresh `getFullAXTree`). Each human action drives the **existing** `beginStep(clickedRef)` → `completePending(toAX)` state machine — the same one agent runs use.
2. **Buffer.** Steps accumulate as `RawAXStep[]` via the existing `getRecordedSteps()`. No new buffer, no new shape.
3. **Confirm.** On *Done*, an inline review card shows the captured steps. User confirms the inferred **name**, marks which `type` steps are **parameters** and which click is a **commit** — three annotations, all on fields that already exist (`acceptsInput`, `commit`) plus one new `State.taughtAs`.
4. **Ingest.** The buffer POSTs to the **existing** `/ingest-ax` → `ingestAX` → `ActionEffect[]` in `RecordStore`, tagged `origin:'extension'`. Byte-identical to what `record-live` and agent runs produce.
5. **Review + draft.** The session flows through the **existing** `dev review` gate → `graph-analyse --draft` (5-axis inference) → `graph-edit` merges states/affordances/fingerprints into the map. `taughtAs` lands on the destination state.
6. **Recall/walk.** `list_routes` (already "call this FIRST") now surfaces the taught destination — preferring `taughtAs` over the inferred slug — so on a later natural-language goal the agent finds it via `check_route`/`findPath` and `walk`s it deterministically at near-zero tokens. **No new invocation UI; the user never types a skill name.**

The only genuinely new code is the human-event → `beginStep` bridge (step 1). Everything from `RawAXStep[]` onward is the tested path.

## 3. The UX (grounded in the actual panel)

**Entering.** Add **Teach** as a third segment beside the existing Ask/Act switch — teaching is a *mode of the session*, not a `/teach` command that vanishes. Flipping it:
- Header swaps the "agent is driving" map-pin for a **red REC dot + "recording your steps"** — the loud opposite of the retired extension's silent failure.
- Composer placeholder → *"demonstrate the task — I'll watch."* The composer's job changes to an optional per-step note box (defer to phase 2).
- Tab-group label reads **`webnav ⏺ teaching`** (reuses the existing `webnav ✓` / `⏸ paused` label pattern) — glanceable consent.

**Live capture feed.** Reuse `actionRow()` verbatim — one waypoint chip per *your* action instead of the agent's: **`click` Rooms**, **`type` Date field** rendered as `••••` / "(your input)" (never the literal), a page-break divider on navigation. Three always-on confidence signals (the anti-silent-failure design):
- **Live step counter** in the rail header ("7 steps captured") — a click with no chip within ~1.5s is the visible tell.
- **Per-chip health dot**: green = clean AX diff + resolvable ref; amber = "captured but couldn't pin which element" (a `clickedRef:null` on a non-nav — maps exactly to what `reconstructEffectFromNodes` can/can't build).
- The `webnav ⏺ teaching` tab label.

**Confirm screen (inline review card).** The panel front-end for the existing `dev review` gate:
- **Name** field, prefilled from the destination state's declared name + first navigate label (zero-LLM default; SDK layer may propose nicer phrasing).
- **Delete** a stray step (removes from buffer pre-ingest). **No reorder** — steps are causally ordered by AX diffs; reordering would lie. Re-teach instead.
- **Parameter toggle** per `type` step (default ON — treat inputs as parameters unless told otherwise) → sets `acceptsInput` to the field's name; the typed *value is discarded*.
- **Commit toggle** on the state-changing click webnav flags as commit-looking ("Confirm booking") → sets `commit:true`. It *asks*, never guesses silently.
- One button: **Save skill** → runs the gate; on gap (amber/unresolved) offers "re-teach these steps" rather than saving broken; on pass, drafts. Toast: *"Saved 'Book a meeting room' — any agent can now walk this."*

**Invoking later.** Nothing to memorize — type a goal in Ask/Act, the agent's mandatory `list_routes`-first call finds the taught route and walks it. A collapsible **"Taught routes"** disclosure (fed by `list_routes`, collapsed by default) gives discovery + trust — phase 3.

## 4. Capture architecture — the decision

**Pick: the hybrid (content script = WHEN/WHERE, CDP = WHAT).**

Reasoning: CDP has no "the user clicked element X" event (`Input.dispatchMouseEvent` is one-way), so pure-CDP can't know where a human clicked. A content script *can* report the click — and the retired extension's lesson was about **snapshot source, not click detection**: it died because it read a *DOM-walked a11y approximation as the tree*. So the content script reports **only** `{kind, x, y}` (+ cheap disambiguators: tagName, trimmed textContent, aria-label) and **never reads the tree or the value**. Background then does the mirror of the existing agent-click chain:

`DOM.getNodeForLocation({x,y})` → `backendNodeId` → find the AX node whose `backendDOMNodeId` matches → that's the `clickedRef` → call the **existing** `beginStep(bRef)` with `fromAX` = a fresh `getFullAXTree`. `toAX` is taken on `chrome.tabs.onUpdated status==='complete'` (navigation) or a ~300ms mutation-quiet debounce (SPA), with **`classifyReadiness` reused verbatim** to reject a loading shell — the same trigger `live-record.ts` already trusts. This lives in `background.ts` (it already owns the single persistent attach).

**Fallback:** if `getNodeForLocation` hits a wrapper `<div>` with no AX node, walk up the AX `parentId` chain to the nearest node with a role *and* an accessible name matching the content script's reported textContent (deepest such ancestor wins). If even that misses, the chip goes **amber** and the AX diff is still recorded so the fingerprint can recover from the diff — capture is never silently dropped.

## 5. What teaching adds over passive recording

Six semantic upgrades; four need **zero new storage**:
- **Goal naming** — the demo's destination gets a durable human label. *Stored: new nullable `State.taughtAs`; `list_routes` prefers it over the inferred slug (one-line formatter change).*
- **Parameter slots** — human confirms which typed value was *the point* vs incidental. *Stored: existing `Affordance.acceptsInput` (set + named); the value itself is discarded.*
- **Commit tagging** — human authoritatively flags the point of no return, beating declaration-sniffing. *Stored: existing `Affordance.commit` boolean.*
- **Disambiguation ground truth** — a human deliberately clicking "Edit on the Acme row" is durable truth for the fingerprint anchor vs an agent's incidental pick; surface plainly when it folds to a `scope:'row'` affordance. *Stored: nothing new — `elementFp`/`scope:'row'` already set by the same `recoverFingerprint` path.*
- **Frontier-driven asks** — before teaching, show 2-3 concrete gaps from the existing `dev frontier` (dangling `toState===null` affordances) as suggested prompts instead of a blank box. *Stored: nothing — UI-only; list verbatim, never score (that would be webnav judging, #5a).*
- **Provisional confirmation** — a taught revisit of a `provisional` state is just the second visit axis-4 cross-visit-variance already resolves. *Stored: nothing — free by going through the same `graph-analyse` pass.*

Net: **one new column (`State.taughtAs`) + a confirm-time UI pass over the draft `graph-analyse --draft` already produces.** No new pipeline stage, no LLM (the confirm asks the *human*).

## 6. Differentiation

Claude-for-Chrome's teach mode makes one model better at one task, replayed by a fresh LLM call every time, trapped inside that user's install and un-exportable. Teach makes the *same single demonstration* produce two compounding artifacts at once: a deterministic, `walk`-able route replayable at near-zero tokens by *any* agent (any model, including Haiku), **and** a durable contribution to the shared structural map that every future teach — yours or a teammate's imported map pack — starts richer from. The artifact is a *map*, not a *memory inside one model* — which is what makes it compound across teachings, users, and redesigns.

**Where theirs is honestly better:** in-run flexibility (an LLM adapts to reflowed layouts / different data each run; a taught route self-heals via fingerprint or correctly stops and escalates — we do *not* chase improvisation into the replay path, that re-adds an LLM to the hot path, #5a), zero local footprint (Teach needs `webnav dev agent-serve` running), and one-off tasks (no map to keep correct → less overhead). Teach is positioned for **repeated** workflows, not one-shots.

## 7. MVP cut (ponytail)

**Phase 1 — one increment, click-only.** Ship Teach as the third segment with ONLY: (a) the human-click→`beginStep` bridge — content script emits `{kind:'click',x,y}`, background does coords→backendNodeId→AX-ref→`beginStep`, takes `toAX` on `onUpdated complete` or a 300ms mutation-quiet debounce (reuse `classifyReadiness`); (b) live chips on the existing `actionRow` rail + a step counter + REC dot; (c) *Done* flushes `getRecordedSteps()` → the **unchanged** `/ingest-ax` → review gate → `graph-analyse --draft`; (d) name inferred + confirmed in one field, stored on new `State.taughtAs`, with the one-line `list_routes` change. Delete the "manual actions not recorded yet" caveat in the pause UI.

That alone delivers *demonstrate once → walkable named route + enriched map*, auto-recalled with **zero new invocation UI**.

**Deferred, add when a real taught flow needs it:**
- **Phase 2** — typed-field capture (same `beginStep` on `input`/change, value never transmitted) + the parameter/commit toggles in the confirm card + per-step notes. (Re-teach works *for free* now — `ingestAX` already `clearSession`s and replaces on same-session re-ingest — so no dedicated UI.)
- **Phase 3** — collapsible "Taught routes" disclosure, frontier-suggested prompts, mid-flow partial teach (stitch by `matchState`), mid-demo undo, multi-tab handling.

## 8. Sharp edges + policies

- **Consent** — Teach is an explicit per-session mode, visibly distinct from Ask/Act ("recording your steps" vs "driving for you"); the tab label reads `webnav ⏺ teaching`. Never on just because the panel is open.
- **Debugger banner honesty** — the yellow "debugging this browser" banner (persistent attach by design) stays identical for teaching. **No stealth mode** that suppresses it — that crosses from sensor to surveillance.
- **Secrets — enforced at the capture boundary, not the render boundary.** The content script reports `{kind,x,y}` and **never transmits `.value`**; `RawAXStep` carries no value field. But **verify the input's AX `value` node is scrubbed from `fromAX`/`toAX` before ingest** — a field's AX tree can carry the typed text, and "show ••••" in the chip is not enough (a password would land in `webnav.db`). This is the one place secret-safety needs an explicit check against the real AX node shape.
- **Commit points** — a human clicking "Pay" during a demo is the human's choice; webnav dispatches nothing. The step is tagged `commit` (confirmed by the user) and **never auto-fired on later replay** — that rule lives in `walkRoute`, untouched. A taught flow is not exempt.
- **Drift → fail closed** — identical to the walk contract (#3/#5a): on real drift the walk returns `needs-navigation` to the agent, never guesses among candidates. One demo is not proof the site won't change; the self-heal/escalate contract is what keeps a taught route trustworthy over time.
- **Auth pages** — credentials never enter the map (#6); a login step becomes an `input`-gated `navigate` with `needs`, resolved via the existing `creds` mechanism at walk time.

## 9. Open questions for the maintainer (only build-changing ones)

1. **Origin tag:** reuse `origin:'extension'` for taught sessions, or add `'teach'` to the union (record.ts:109)? Only matters if the dashboard must visually separate human-taught from agent-recorded routes — one-line if yes, skip if no.
2. **`taughtAs` on the destination state vs the route:** the ask leans destination (that's what `list_routes`/`check_route` key on). Confirm — if a taught demo passes through a state also reachable untaught, does the label belong to just that state (simple) or the edge sequence (a saved *named route*, closer to the pitch but a bigger concept)?
3. **`toAX` freshness:** fresh `getFullAXTree` per human click (accurate, ~1 CDP call/click — free at human pace) vs reusing the cached last tree (cheaper, can be stale after an unobserved same-page change)? This sets the capture-loop shape.
4. **Confirm-card friction:** are the parameter/commit questions a hard gate, or does *skip* fall back to today's inference guess so teaching never blocks? (Determines whether phase-1 ships the card at all or just the name field.)
5. **`dev review` prompt:** does the gate need a teach-specific prompt (the screencast shows a *human* acting, not the agent cursor gliding), or is the frame-vs-step audit source-agnostic as-is? Affects whether phase 1 touches `review.ts` (which is behind the recorder-code-fixes gate).

---

*Conflicts resolved:* Entry point — **third mode segment**, not `/teach` or a repurposed Pause (teaching is a session posture; conflating "take over" with "record my demo" muddles consent). Capture — **hybrid content-script+CDP** over pure-CDP (CDP can't detect human clicks) and over content-script-only (that was the retired approach's fatal snapshot source). Naming — **inferred-then-confirmed**, not demanded upfront (avoids bureaucratic gate) but required for the walk target (not anonymous). Goal storage — **`State.taughtAs` field**, NOT resurrecting the deleted `Goal` engine (parked per 2026-06-12; fewest moving parts).

## Decisions (2026-07-20)

Answers to the five open questions (§9), settled for implementation:

1. **Origin tag:** add `'teach'` to the origin union (not a reuse of `'extension'`). The
   dashboard needs to visually separate human-taught sessions from agent-recorded ones —
   Sessions list badge reads **Taught**, and the source filter gets a **Taught** option.
2. **`taughtAs` location:** on the destination **State**, not the edge sequence. Matches
   what `list_routes`/`check_route` key on today and avoids introducing a new named-route
   concept — the simpler of the two options in the original ask, taken deliberately.
3. **`toAX` freshness:** a fresh `getFullAXTree` per human click, not the cached last tree.
   Accurate over cheap — one CDP call per click is free at human demonstration pace, and a
   cached tree risks silently missing an unobserved same-page change between clicks. A
   cache-miss (no matching AX node for the reported click) surfaces as an **amber** chip,
   never a silent drop.
4. **Confirm-card friction:** name-only in phase 1, and **skippable** — Save works with just
   the inferred (or edited) name; there is no hard gate on parameter/commit toggles yet
   (those stay deferred to phase 2 per §7). Teaching must never block on a UI step beyond
   naming the route.
5. **`review.ts`:** left **untouched**. Taught sessions are auto-approved through the
   existing `setReview` mechanism with reason `'human-confirmed teach demonstration'` — the
   teacher watching the live chips land in real time IS the attestation, standing in for the
   usual frame-vs-step capture-gap audit. This is flagged explicitly to the maintainer as
   the **one deliberate bend of the review gate**: every other origin earns its review the
   normal way; `teach` sessions self-certify by construction (a human drove every step and
   watched it register). If that trust assumption ever proves wrong in practice, this is the
   first place to revisit — not `review.ts` itself.
