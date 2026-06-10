import type { State } from '../mapstore/types.js';
import type { MapStore } from '../mapstore/store.js';
import type { RecallResponse } from '../protocol.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { matchState } from '../explorer/fingerprint.js';
import { replayStep } from './replay.js';
import { resolveStep } from './resolve.js';

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
  callCount(): number;
}

export type WalkAnswer =
  | { kind: 'ref'; ref: string }
  | { kind: 'classify'; verdict: 'safe' | 'commit' };

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

  // Halt as soon as we've arrived: this check at the TOP means when goalStateId is
  // a state the route passes THROUGH (e.g. sd:checkout-overview), the walk stops
  // there and never attempts the next edge (the Finish commit point).
  while (current !== goalStateId) {
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
        const ref = resolveStep(edge.semanticStep, parseSnapshot(yaml));
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
        store.recordOutcome(edge.fromState, edge.toState, edge.semanticStep, true);
        current = edge.toState; at++;
        continue;
      } else {
        // 'ref': act on the agent-chosen element, skip replayStep for THIS step.
        await browser.act(ans.ref, edge.acceptsInput);
        const afterYaml = await browser.snapshot();
        const observed = matchState(parseSnapshot(afterYaml), states);
        if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
          return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
            question: 'after applying the supplied ref, expected ' + edge.toState + ' but observed '
              + (observed.status === 'matched' ? observed.state.id : observed.status) };
        }
        store.recordOutcome(edge.fromState, edge.toState, edge.semanticStep, true);
        current = edge.toState; at++;
        continue;
      }
    }
    firstStep = false;

    // Tier-1 addressable jump: the destination has a canonical URL, so the link
    // need not be resolved as a ref (it may be icon-only / unstable). Jump, then
    // verify by observation exactly like a resolved action. Commit points still
    // never auto-fire — an addressableUrl on a commit edge would be a misconfig, so
    // we still route commit/unclassified through replayStep's guard below.
    if (browser.goto && edge.addressableUrl && edge.kind !== 'commit-point' && edge.kind !== 'unclassified') {
      await browser.goto(edge.addressableUrl, edge.acceptsInput);
      const afterYaml = await browser.snapshot();
      const observed = matchState(parseSnapshot(afterYaml), states);
      if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
        return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
          question: 'jumped to ' + edge.addressableUrl + ' but expected ' + edge.toState + ' — observed '
            + (observed.status === 'matched' ? observed.state.id : observed.status) };
      }
      store.recordOutcome(edge.fromState, edge.toState, edge.semanticStep, true);
      current = edge.toState; at++;
      continue;
    }

    // Read the CURRENT page (before acting) so commit/drift checks see this page.
    const yaml = await browser.snapshot();
    const nodes = parseSnapshot(yaml);

    const r = replayStep(edge, nodes);
    if (r.status === 'blocked-commit' || r.status === 'needs-classify') {
      // Commit-point halt: NEVER act. Hand the action to the agent to classify.
      return { status: 'needs-classification', action: edge.semanticStep, snapshot: yaml };
    }
    if (r.status === 'escalate') {
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
    const afterYaml = await browser.snapshot();
    const observed = matchState(parseSnapshot(afterYaml), states);
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
    store.recordOutcome(edge.fromState, edge.toState, edge.semanticStep, true);
    current = edge.toState;
    at++;
  }

  // Reached the goal. Goal-state evidence is minimal for W1 (YAGNI) — the focus of
  // this increment is the WALK + escalation; a later increment enriches evidence.
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
