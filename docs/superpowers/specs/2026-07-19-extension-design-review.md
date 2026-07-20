# webnav extension — design review (2026-07-19)

> Produced by a 4-lens adversarial review workflow (security / MV3-lifecycle / UX-vs-Claude /
> architecture), each finding verified by an independent skeptic before counting. 32 raised →
> **16 CONFIRMED, 2 PLAUSIBLE, 13 REFUTED.** The synthesis step died on an infra watchdog; this
> doc is reconstructed from the run journal (verdicts + reasons preserved verbatim in intent).

## Verdict

The extension is **architecturally sound but not yet safe or honest enough to call "done."** The
engine stays zero-LLM, the CDP nodeId id-space is coherent, the detach-on-close fix holds. But the
review found one **security hole** (an unauthenticated localhost server that executes CDP commands),
a cluster of **"UX lies"** (permission modes + plan-approval that don't actually gate), and a
**functional gap** (the agent can't navigate — `goto` is unwired) that also blocks recall. None are
architectural rewrites; all are targeted fixes.

The top 3 to fix: (1) authenticate the local channel; (2) make Ask/Auto/Act + plan-approval actually
gate, or remove them; (3) wire `goto`/tab-creation so the agent can navigate (fixes both a critical
and the "must be on a webpage" complaint).

## CONFIRMED — Critical

1. **No-auth localhost channel executes CDP** (`src/agent/server.ts:73`). Server is CORS `*`,
   zero auth. Any web page the user visits (via a localhost `fetch`/DNS-rebind) or any local process
   can `POST /api/agent/goal` and drive the user's browser over the debugger. **Fix:** a per-session
   token the extension mints and the server requires on every route; reject cross-origin `fetch`
   (drop CORS `*`; the extension isn't a browser page origin).
2. **Extension blindly executes every `action`** (`webnav-extension/background.ts:~228`). No
   commit/destructive guard on the extension side — it dispatches whatever click/type the server
   sends. Commit-protection is claimed server-side (walkRoute needs-classification) but the extension
   trusts the channel unconditionally. **Fix:** with (1) the channel is trusted; still, surface
   destructive-looking actions for confirmation in Ask mode (ties to #3).
3. **Permission modes are cosmetic** (`src/agent/loop.ts:161`). `defaultQuery` ignores `mode` and
   hardcodes `permissionMode:'default'`. Ask/Auto/Act produce byte-identical behavior. **Fix:** map
   mode → gate level (Ask = confirm every navigate; Auto = confirm commits only; Act = commits only).
4. **Plan-approval doesn't gate** (`webnav-extension/sidepanel.ts:~200`). The run has already
   started and is streaming actions before the plan bar renders; Approve is `bar.replaceWith(...)` —
   it sends nothing, blocks nothing. **Fix:** in Ask mode the server must WAIT for an approve POST
   before the loop executes any action.
5. **`goto`/`currentUrl` unwired in the channel** (`src/agent/server.ts:66`). The server channel
   implements only `getAX`+`dispatch`; `browser.goto` is undefined, so walkRoute's addressable-URL
   jump is silently skipped (the only way it reaches the seeded saucedemo cart) — AND the agent
   can't navigate at all. **Fix:** wire `goto` (extension does `chrome.tabs.update`/`create`) +
   `currentUrl`. **This is also the fix for "why must I be on a webpage" — see the note below.**
6. **Stale-nodeId fallback can't recover** (`webnav-extension/background.ts:~86`). On a re-render,
   `nodeCenter` re-fetches `getFullAXTree` (fresh ephemeral ids) then looks up the OLD id → always
   throws; the comment claiming it recovers is false. **Fix:** on a stale id, re-snapshot and let the
   loop re-resolve by fingerprint (it already does), rather than pretending to recover in background.

## CONFIRMED — Important

- **Orphaned popup + stale README** (`manifest.json`): the Phase-1 "Capture this page" popup is
  unreachable (icon opens the panel), uses a different session/port, and the README still says
  "click the icon → Capture". Fix: fold capture into the panel or remove it; fix the README.
- **No activity status** (`sidepanel.ts:~124`): no persistent "working / which tab / done"
  indicator; narration scrolls away. Fix: a header status + which-tab display.
- **Contract drift** (`sidepanel.ts:8`): `Cmd`/`AgentEvent` are hand-copied from `server.ts` with no
  shared type or build check — they will drift. Fix: a shared contract module or a build-time assert.
- **host_permissions `<all_urls>` + debugger + tabs** = maximal blast radius (compounds #1).
- **Pause resumes the wrong tab** if the user switched tabs during pause (`sidepanel.ts:227`).

## CONFIRMED — Minor
- tab-group never ungrouped (accumulates / destroys the user's grouping) — `sidepanel.ts:250`.
- single-panel assumption: two SSE clients both execute every action — `server.ts:42`.
- double narration (channel `action` + loop `narrate` for the same call) — `sidepanel.ts:124`.
- AbortSignal→Stop not wired: Stop can't cancel an in-flight SDK turn, only the next command — `loop.ts:174`.

## PLAUSIBLE (couldn't fully confirm without a browser)
- empty first-run thread / no onboarding (`sidepanel.html:64`) — real gap, low risk.
- one architecture finding whose impact framing was overstated (technical core confirmed).

## REFUTED (correctly dropped — 13)
Notable: the whole **MV3 service-worker-death-mid-run cluster** (reviewers proved the SW does NOT
idle-terminate during an active drive attach the way the findings claimed); the **`disconnected`
message** and **missing icons** (both describe PRE-FIX code — already fixed 2026-07-19); the
credential-cleartext framing (overstated); the pulse XSS (numeric coords, not a vector); a couple of
detach-gating and cold-start-panel claims that didn't hold against the actual code.

## What's genuinely good (verified sound)
- Zero-LLM engine preserved; `walkRoute` unmodified; commit verdict still hard-halts.
- CDP nodeId id-space coherent end-to-end in the normal one-read-one-act loop.
- narrate/action split holds (loop emits zero executable `action`).
- detach-on-panel-close (the port) closes the zombie-banner leak.

## Note on "why must I be on a webpage" (user, 2026-07-19)
The `chrome://`/blank-tab refusal is too blunt. `chrome.debugger` genuinely can't attach to
`chrome://`/New-Tab/Web-Store pages (hard Chrome rule), but the fix is NOT to refuse — it's to
**open/navigate a real tab and drive that**, like Claude's extension. This is the same fix as
Critical #5 (`goto`/tab-creation unwired). Correct behavior: launch from any tab; if the current one
isn't drivable, create a new tab (or go to a start URL) and drive it.

## Prioritized fix list
1. **[crit #5 + user #1]** Wire `goto`/`currentUrl` + "open a drivable tab": agent can navigate;
   launching from a blank/chrome:// tab opens a real page instead of erroring.
2. **[crit #1]** Authenticate the localhost channel (per-session token; drop CORS `*`).
3. **[crit #3+#4]** Make Ask/Auto/Act + plan-approval actually gate (or cut them until they do).
4. **[crit #6]** Fix the stale-nodeId path (re-snapshot, don't fake-recover).
5. **[important]** Remove/fold the orphaned popup; fix README; add activity status; shared contract type.
6. **[minor]** ungroup on finish; single-panel guard; drop double narration; wire Stop→abort.
