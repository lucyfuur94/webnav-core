import type { State, Edge, Affordance } from '../mapstore/types.js';
import type { MapStore } from '../mapstore/store.js';
import type { RecallResponse } from '../protocol.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { matchState } from '../explorer/fingerprint.js';
import { replayStep } from './replay.js';
import { resolveStep } from './resolve.js';
import { deriveNear } from '../playwright/fingerprint.js';
import { classifyAuthLanding } from './auth-status.js';

/**
 * SELF-HEAL write-back after an agent picks an element at a fork. Persist a DURABLE
 * fingerprint so the next walk resolves the once-ambiguous step without re-asking (#3):
 *  - compute `near` for the chosen node via the SHARED deriveNear (so record + heal agree);
 *  - if the edge was projected from an affordance (viaAffordance), write {role,name,near}
 *    onto that AFFORDANCE (recordElementFp — both motivating maps have no edge rows);
 *  - else fall back to recordSelector on the legacy stored row.
 * A chosen node with a null name and no derivable `near` can't be made durable → store
 * nothing (the step honestly stays a per-walk escalation; D1).
 */
function healStep(store: MapStore, edge: Edge, beforeNodes: SnapNode[], chosen: SnapNode | undefined, chosenIdx: number): void {
  if (!chosen) return;
  const near = chosenIdx >= 0 ? deriveNear(beforeNodes, chosenIdx, chosen.role, chosen.name) : null;
  if (edge.viaAffordance && (chosen.name || near)) {
    // affordanceOwner: a projected _shell edge rewrites fromState to the asking page, but the
    // affordance lives on the shell state — write the repair where the affordance actually is.
    store.recordElementFp(edge.affordanceOwner ?? edge.fromState, edge.viaAffordance, { role: chosen.role, name: chosen.name, near });
    return;
  }
  // legacy stored-edge fallback (no backing affordance): name-only selector cache, as before.
  if (chosen.name) store.recordSelector(edge.fromState, edge.toState, edge.semanticStep, chosen.name);
}

/**
 * SSO-wall handling (design item 2): when a navigate-edge step lands somewhere that
 * doesn't match the expected toState, check whether the landing IS an auth wall —
 * classifyAuthLanding against the site's own map states (the map is the oracle, same
 * as profile-status / Task A). If it's a wall AND the browser can reopen fresh
 * (`reopenFresh` present — live wiring only), retry ONCE: close this session, open a
 * brand-new one under the SAME profile (same identity/cookies — equivalent to the
 * user reopening a tab; NOT evasion), reload `retryUrl`. A fresh session's first
 * load reliably passes Cloudflare-Access-style step-up (observed live). Never
 * loops: a wall on the retry is reported honestly as `needs-auth` instead of a
 * generic drift escalation.
 *
 * `retryUrl` vs `landedUrl`: classification always uses the LANDED url (that IS the
 * wall, and it's what needs-auth reports as loginUrl), but the RELOAD target should
 * be a known-good coordinate when one exists — challenge urls often carry one-time
 * nonces that error on reload. The addressableUrl call site passes the edge's
 * canonical url so the redirect chain re-runs from a clean start.
 *
 * Returns `null` when there's no wall (caller falls through to its normal drift
 * escalation), the retried snapshot when the retry cleared the wall (caller
 * re-runs its own match against this fresh snapshot), or a `needs-auth`
 * RecallResponse when the wall persists through the retry (or no retry was
 * possible — a bare foreign-host/interstitial landing is reported the same way,
 * never silently swallowed as generic drift).
 */
async function checkAuthWall(
  browser: WalkBrowser, states: State[], at: number, retriedRef: { done: boolean },
  landedUrl: string, landedSnapshot: string, retryUrl: string, profile: string | undefined,
): Promise<{ response: RecallResponse } | { retried: string } | null> {
  const site = states[0]?.nodeId;
  if (!site) return null;
  const first = classifyAuthLanding(landedUrl, landedSnapshot, site, states);
  if (first.auth !== 'needs-login') return null;

  if (retriedRef.done || !browser.reopenFresh) {
    return { response: { status: 'needs-auth', at, profile: profile ?? 'default', site, loginUrl: first.loginUrl ?? landedUrl } };
  }
  retriedRef.done = true;   // once per walk — a wall on the retry is persistent, never loop
  const afterSnapshot = await browser.reopenFresh(retryUrl);
  const afterUrl = browser.currentUrl ? await browser.currentUrl() : retryUrl;
  const retryClass = classifyAuthLanding(afterUrl, afterSnapshot, site, states);
  if (retryClass.auth === 'needs-login') {
    return { response: { status: 'needs-auth', at, profile: profile ?? 'default', site, loginUrl: retryClass.loginUrl ?? afterUrl } };
  }
  return { retried: afterSnapshot };
}

// Minimal browser the walk drives. The live adapter implements this; tests fake it.
// ASYNC so ONE walk loop serves both the scripted unit fake and the real
// (Promise-returning) PlaywrightAdapter — no duplicated loop.
export interface WalkBrowser {
  snapshot(): Promise<string>;          // current page snapshot YAML
  // Perform the resolved action for an edge. `ref` is the element to act on;
  // `inputSlot` (if the edge declares acceptsInput) names the runtime input to use.
  // The live browser owns the `inputs` map and looks the slot up; the unit fake
  // ignores both and just advances the scripted snapshot.
  act(ref: string, inputSlot: string | null): Promise<void>;
  // Jump to a tier-1 addressable URL (edge.addressableUrl) instead of resolving a
  // ref — for icon-only/unstable links whose destination has a canonical URL. The
  // unit fake just advances its scripted snapshot (ignores the url).
  goto?(url: string, inputSlot: string | null): Promise<void>;
  // Sleep `ms` between readiness retries (JS-render race). Live browser implements it;
  // the unit fake omits it so tests resolve immediately (no waiting / no retry loop).
  waitMs?(ms: number): Promise<void>;
  callCount(): number;
  // The URL the browser is currently settled on — needed to classify an SSO-wall
  // landing (classifyAuthLanding wants landedUrl + site host). Optional: the unit
  // fake omits it, which simply disables the fresh-session wall retry in tests.
  currentUrl?(): Promise<string>;
  // Close the current browser session and reopen a FRESH one under the SAME
  // profile (same identity/cookies — equivalent to the user reopening a tab; NOT
  // evasion), landing back on `url`. Returns the settled snapshot after reopen.
  // Optional: only the live wiring supplies this; when absent the wall check is
  // skipped (no profile to retry under / test fake has no browser to reopen).
  reopenFresh?(url: string): Promise<string>;
  // Close whichever browser session is CURRENTLY live. A wall retry may have
  // rotated to a brand-new session (see reopenFresh); callers that hold their own
  // adapter reference should close through here instead so they close the right
  // one. Optional: the unit fake and one-off scripts don't need it.
  close?(): Promise<void>;
  // The id of whichever browser session is CURRENTLY live — rotates after a
  // reopenFresh. Callers that persist a paused-walk's browser session (the CLI's
  // walk-session store) read this AFTER the walk returns, so a session rotated
  // mid-walk is the one actually reported/resumed. Optional, live wiring only.
  sessionId?(): string;
}

export type WalkAnswer =
  | { kind: 'ref'; ref: string }
  | { kind: 'classify'; verdict: 'safe' | 'commit' }
  | { kind: 'continue' };      // answers a checkpoint pause — no action, just proceed

export interface WalkArgs {
  goalName: string;
  startStateId: string;        // e.g. 'sd:login'
  goalStateId: string;         // e.g. 'sd:checkout-overview'
  store: MapStore;
  states: State[];             // known states for matchState (the skeleton's states)
  browser: WalkBrowser;
  path?: string[];             // resolved route (from findPath); follow it instead of edges[0]
  answer?: WalkAnswer;         // resume answer applied to the FIRST step taken this call
  // NOTE: `inputs` was REMOVED from WalkArgs (cleaner option per W2). The walk no
  // longer touches runtime values; it only passes each edge's `acceptsInput` slot
  // NAME to browser.act(). The LIVE browser closure owns the inputs map and resolves
  // the slot -> value when filling fields. Keeps the walk runtime-value-free.
  profile?: string;            // named profile the browser is running under (reported on needs-auth)
  // CHECKPOINT CALLBACK (opt-in — walk stays zero-token autopilot by default):
  observe?: string[];          // state ids to pause on ARRIVAL (resolved by the caller, like start/goal)
  observeDynamic?: boolean;    // pause on arrival at any state the MAP marks dynamic (see isDynamicState)
  observed?: string[];         // state ids whose checkpoint already fired this walk (persisted across resumes)
}

// A state is "dynamic" (per the checkpoint design) when its identity may not be
// stable structure — either it's `provisional` (seen only once) or it has an
// in-page affordance folded from repeated siblings (`scope: 'row'|'widget'`,
// e.g. a table row or a repeated card). Judgment-free: a fixed structural test,
// not a guess about what's "interesting".
function isDynamicState(state: State): boolean {
  if (state.provisional) return true;
  return state.affordances.some((a) => hasDynamicScope(a));
}
function hasDynamicScope(a: Affordance): boolean {
  if (a.scope === 'row' || a.scope === 'widget') return true;
  return (a.children ?? []).some(hasDynamicScope);
}

// Build the checkpoint response for a CONFIRMED arrival at `state`, or null if no
// checkpoint should fire (not requested, or already fired once this walk).
async function checkForCheckpoint(
  args: WalkArgs, observedSoFar: Set<string>, at: number, state: State, browser: WalkBrowser,
): Promise<RecallResponse | null> {
  if (observedSoFar.has(state.id)) return null;
  const wantsNamed = (args.observe ?? []).includes(state.id);
  const wantsDynamic = !!args.observeDynamic && isDynamicState(state);
  if (!wantsNamed && !wantsDynamic) return null;
  observedSoFar.add(state.id);
  const snapshot = await browser.snapshot();
  return { status: 'checkpoint', at, state: state.id, snapshot, repertoire: state.affordances };
}

/**
 * The interactive multi-step walk (design §3). Walks a linear route edge-by-edge
 * from `startStateId` toward `goalStateId`, verifying every step (prediction vs
 * observation) and escalating to the agent on drift or at a commit point.
 *
 * Zero LLM: replayStep resolves deterministically (cached ref, then role+name);
 * any decision webnav isn't allowed to make is handed back as a `needs-*` response.
 */
export async function walkRoute(args: WalkArgs): Promise<RecallResponse> {
  const { goalName, startStateId, goalStateId, store, states, browser } = args;

  let current = startStateId;
  let at = 0;
  let firstStep = true;
  // Fresh-session wall retry: at most ONCE per walk call (design item 2 — a wall
  // surviving the retry is persistent, never loop).
  const authRetried = { done: false };
  // Checkpoint fired-once tracking (persisted across resumes via args.observed).
  const observedSoFar = new Set(args.observed ?? []);

  // Halt as soon as we've arrived: this check at the TOP means when goalStateId is
  // a state the route passes THROUGH (e.g. sd:checkout-overview), the walk stops
  // there and never attempts the next edge (the Finish commit point).
  while (current !== goalStateId) {
    // CHECKPOINT: `current` is always a CONFIRMED arrival at the top of this loop
    // (the start state, or set only after prediction-vs-observation matched) — the
    // right place to trigger, per the design (a checkpointed state must be a
    // confirmed arrival). Skipped when we're about to consume a resume answer for
    // THIS state (the agent already saw it via the pause that led here).
    if (!(firstStep && args.answer)) {
      const here = store.getState(current);
      if (here) {
        const cp = await checkForCheckpoint(args, observedSoFar, at, here, browser);
        if (cp) return cp;
      }
    }
    const edges = store.edgesFrom(current);
    if (edges.length === 0) {
      return { status: 'failed', reason: 'no edge from ' + current };
    }
    // Linear route: each non-goal state has exactly one outgoing edge.
    let edge = edges[0];
    if (args.path) {
      const i = args.path.indexOf(current);
      const next = i >= 0 ? args.path[i + 1] : undefined;
      const onPath = next ? edges.find((e) => e.toState === next) : undefined;
      if (!onPath) return { status: 'failed', reason: 'no path edge from ' + current };
      edge = onPath;
    }

    // Gated edge: pause for the agent to fire the required in-page affordances
    // FIRST, whenever the walk is about to traverse it — NOT just on the first
    // step (a gate is usually mid-route, e.g. inventory->cart after login). The
    // only time we DON'T pause is when a resume answer is being consumed for this
    // very step (firstStep && args.answer) — the agent has already fired them.
    // Ungated edges never pause (autopilot preserved).
    if (!(firstStep && args.answer) && edge.requiresAffordances && edge.requiresAffordances.length > 0) {
      const yaml = await browser.snapshot();
      return {
        status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: yaml,
        question: 'before "' + edge.semanticStep + '", fire these in-page affordances on the current page: '
          + edge.requiresAffordances.join('; '),
      };
    }

    // Resume answer applies only on the FIRST iteration of THIS call.
    if (firstStep && args.answer) {
      const ans = args.answer;
      firstStep = false;
      if (ans.kind === 'classify') {
        if (ans.verdict === 'commit') {
          return doneHalted(args, browser);   // hard halt — never fire a commit point (#2)
        }
        // 'safe': the AGENT has taken responsibility for this step (e.g. it's a
        // demo/dry-run, or genuinely reversible). Resolve + act it DIRECTLY,
        // bypassing replayStep's commit/unclassified guard — otherwise the guard
        // would just re-escalate needs-classification and the answer is ignored
        // (the R5 resume bug). This is the ONLY path that fires a commit edge, and
        // only on an explicit agent "safe" verdict.
        const yaml = await browser.snapshot();
        const ref = resolveStep(edge.semanticStep, parseSnapshot(yaml), edge.selectorCache);
        if (!ref) {
          return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: yaml,
            question: 'classified safe, but cannot resolve "' + edge.semanticStep + '" on the current page' };
        }
        await browser.act(ref, edge.acceptsInput);
        const afterYaml = await browser.snapshot();
        const observed = matchState(parseSnapshot(afterYaml), states);
        if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
          return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
            question: 'after the classified-safe step, expected ' + edge.toState + ' but observed '
              + (observed.status === 'matched' ? observed.state.id : observed.status) };
        }
        current = edge.toState; at++;
        continue;
      } else if (ans.kind === 'ref') {
        // 'ref': act on the agent-chosen element, skip replayStep for THIS step.
        // SELF-HEAL: recover a DURABLE element fingerprint for the chosen node from
        // the current page (the raw ref `e42` is ephemeral — reassigned per snapshot —
        // so we never persist it). We only reach here because resolution MISSED, so
        // the durable role+name+near is what re-resolves next time (#3).
        const beforeNodes = parseSnapshot(await browser.snapshot());
        const chosen = beforeNodes.find((n) => n.ref === ans.ref);
        const chosenIdx = beforeNodes.findIndex((n) => n.ref === ans.ref);
        await browser.act(ans.ref, edge.acceptsInput);
        const afterYaml = await browser.snapshot();
        const observed = matchState(parseSnapshot(afterYaml), states);
        if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
          return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
            question: 'after applying the supplied ref, expected ' + edge.toState + ' but observed '
              + (observed.status === 'matched' ? observed.state.id : observed.status) };
        }
        healStep(store, edge, beforeNodes, chosen, chosenIdx);
        current = edge.toState; at++;
        continue;
      }
      // ans.kind === 'continue': a checkpoint answer — no action to consume. Fall
      // through to the normal step logic below for the CURRENT state (the checkpoint
      // already skipped itself via observedSoFar, so it won't re-fire).
    }
    firstStep = false;

    // Tier-1 addressable jump: the destination has a canonical URL, so the link
    // need not be resolved as a ref (it may be icon-only / unstable). Jump, then
    // verify by observation exactly like a resolved action. Commit points still
    // never auto-fire — an addressableUrl on a commit edge would be a misconfig, so
    // we still route commit/unclassified through replayStep's guard below.
    if (browser.goto && edge.addressableUrl && edge.kind !== 'commit-point' && edge.kind !== 'unclassified') {
      await browser.goto(edge.addressableUrl, edge.acceptsInput);
      let afterYaml = await browser.snapshot();
      let observed = matchState(parseSnapshot(afterYaml), states);
      if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
        // Retry target = the edge's canonical addressableUrl (a known-good
        // deterministic coordinate), NOT the landed wall url — challenge urls often
        // carry one-time nonces that error on reload; reloading the canonical url
        // fresh lets the redirect chain re-run.
        const landedUrl = browser.currentUrl ? await browser.currentUrl() : edge.addressableUrl;
        const wall = await checkAuthWall(browser, states, at, authRetried, landedUrl, afterYaml, edge.addressableUrl, args.profile);
        if (wall && 'response' in wall) return wall.response;
        if (wall && 'retried' in wall) {
          afterYaml = wall.retried;
          observed = matchState(parseSnapshot(afterYaml), states);
        }
      }
      if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
        return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
          question: 'jumped to ' + edge.addressableUrl + ' but expected ' + edge.toState + ' — observed '
            + (observed.status === 'matched' ? observed.state.id : observed.status) };
      }
      current = edge.toState; at++;
      continue;
    }

    // Read the CURRENT page (before acting) so commit/drift checks see this page.
    // READINESS RETRY: JS-heavy apps (React/Angular/Vue) render the
    // page asynchronously; an immediate snapshot can catch it empty (0 nodes) or
    // pre-render, so the step won't resolve yet. Re-snapshot a bounded number of times
    // until the step resolves, before treating an unresolved step as real drift. This
    // is the same race live.ts handles for search results. `browser.waitMs` lets the
    // live browser sleep between tries; the unit fake omits it (resolves immediately).
    let yaml = await browser.snapshot();
    let nodes = parseSnapshot(yaml);
    let r = replayStep(edge, nodes);
    let prevYaml = '';
    for (let attempt = 0; r.status === 'escalate' && browser.waitMs && attempt < 5; attempt++) {
      prevYaml = yaml;
      await browser.waitMs(800);
      yaml = await browser.snapshot();
      nodes = parseSnapshot(yaml);
      r = replayStep(edge, nodes);
    }
    if (r.status === 'blocked-commit' || r.status === 'needs-classify') {
      // Commit-point halt: NEVER act. Hand the action to the agent to classify.
      // Carry `at` (the absolute path index we paused ON) so the session position
      // stays in sync — a single resume can traverse several states before this
      // halt, and without `at` the handler would advance by only 1 and desync,
      // restarting the NEXT resume at the wrong step.
      return { status: 'needs-classification', at, action: edge.semanticStep, snapshot: yaml };
    }
    if (r.status === 'escalate') {
      // Distinguish a NON-HYDRATING SOFT-BLOCK from real drift (review #9): if after the
      // full retry budget NO known state matched (the expected page never appeared at all)
      // AND the snapshot is STABLE across the last two retries, the page loaded its shell but
      // never rendered — almost always a rate-limit / bot-throttle. Report that honestly so
      // the agent backs off rather than chasing a phantom drift. Gated on fingerprint ABSENCE
      // (matchState none), not size — a legit sparse page (saucedemo login) still matches.
      const unmatched = matchState(nodes, states).status === 'none';
      const stable = prevYaml !== '' && prevYaml === yaml;
      if (unmatched && stable) {
        return {
          status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: yaml,
          question: 'the page loaded but did not render any known state (stable across retries) — '
            + 'likely rate-limited or bot-throttled. Back off and retry later; do NOT hammer it.',
        };
      }
      // Real drift: deterministic resolve couldn't find the step on this page.
      return {
        status: 'needs-navigation',
        at,
        semanticStep: edge.semanticStep,
        snapshot: yaml,
        question: 'expected to reach ' + edge.toState + ' but cannot resolve the step on the current page',
      };
    }

    // r.status === 'ok' — perform the resolved action. Input filling for
    // acceptsInput edges is handled by the live browser via its captured `inputs`;
    // we hand it the slot NAME (edge.acceptsInput) so it knows whether/which input
    // to fill. The unit fake's act() ignores both args and just advances.
    await browser.act(r.ref, edge.acceptsInput);

    // PREDICTION vs OBSERVATION: compare the edge's expected toState against the
    // live snapshot. Mismatch or ambiguity → escalate, never march on blind.
    let afterYaml = await browser.snapshot();
    let observed = matchState(parseSnapshot(afterYaml), states);
    if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
      const landedUrl = browser.currentUrl ? await browser.currentUrl() : '';
      // Retry target is the landed url itself — a click has no known-good target
      // URL to reload (State.urlPattern is a wildcard, not a concrete coordinate),
      // so "reopen the tab you landed on" is the best available retry here.
      const wall = landedUrl
        ? await checkAuthWall(browser, states, at, authRetried, landedUrl, afterYaml, landedUrl, args.profile)
        : null;
      if (wall && 'response' in wall) return wall.response;
      if (wall && 'retried' in wall) {
        afterYaml = wall.retried;
        observed = matchState(parseSnapshot(afterYaml), states);
      }
    }
    if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
      return {
        status: 'needs-navigation',
        at,
        semanticStep: edge.semanticStep,
        snapshot: afterYaml,
        question: 'expected ' + edge.toState + ' but observed '
          + (observed.status === 'matched' ? observed.state.id : observed.status),
      };
    }

    // Success: self-heal write-back, then advance.
    current = edge.toState;
    at++;
  }

  // Reached the goal. Goal-state evidence is minimal for W1 (YAGNI) — the focus of
  // this increment is the WALK + escalation; a later increment enriches evidence.
  // CHECKPOINT goal-state enrichment: done is done (no pause) — but if the goal
  // qualifies by the same dynamic test (or was named via --observe), attach the
  // live snapshot + repertoire so the agent doesn't have to snapshot manually.
  const goalStateRec = store.getState(goalStateId);
  const wantsGoal = !!goalStateRec
    && ((args.observe ?? []).includes(goalStateId) || (!!args.observeDynamic && isDynamicState(goalStateRec)));
  const goalExtra = wantsGoal
    ? { snapshot: await browser.snapshot(), repertoire: goalStateRec!.affordances }
    : {};
  return {
    status: 'done',
    evidence: {
      goal: goalName,
      query: goalName,
      candidates: [],
      cost: {
        playwright_calls: browser.callCount(),
        savings: { raw_snapshot_tokens: 0, bundle_tokens: 0, tokens_saved: 0, chars_per_token: 4 },
      },
      ...goalExtra,
    },
  };
}

// A `done` response that HALTED at a commit point: the agent classified the next
// action as a commit, so the walk stops without firing it (#2). Mirrors the final
// `done` evidence shape exactly, with the `halted` marker set.
function doneHalted(args: WalkArgs, browser: WalkBrowser): RecallResponse {
  return {
    status: 'done',
    evidence: {
      goal: args.goalName, query: args.goalName, candidates: [],
      cost: { playwright_calls: browser.callCount(),
        savings: { raw_snapshot_tokens: 0, bundle_tokens: 0, tokens_saved: 0, chars_per_token: 4 } },
    },
    halted: 'commit-point',
  };
}
