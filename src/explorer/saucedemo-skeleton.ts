import type { State, Edge } from '../mapstore/types.js';
import { makeEdge } from '../mapstore/types.js';
import type { MapStore } from '../mapstore/store.js';

/**
 * The known saucedemo navigation skeleton as pure DATA (principle #6).
 *
 * STRUCTURE ONLY: states + edges between them. It must NEVER contain credentials,
 * names, zips, or any other runtime value — those are supplied at walk time by the
 * LIVE browser closure (e.g. runWalkLive's captured `inputs` map), keyed off each
 * edge's `acceptsInput` slot. walkRoute itself only forwards the slot NAME to act();
 * it never holds runtime values (principle #6 / §4).
 *
 * Fingerprints are arrays of `role` or `role:name` tokens matched by `matchState`;
 * these were captured from the live saucedemo.com site. Note: StateRole has no
 * cart/checkout values, so we reuse `detail` loosely for the inventory/cart/checkout
 * states — the state `id` (e.g. `sd:cart`) is what the walk keys on, not the role.
 */
export const SAUCEDEMO_SKELETON: { states: State[]; edges: Edge[] } = {
  states: [
    {
      id: 'sd:login',
      nodeId: 'saucedemo',
      semanticName: 'sd:login',
      urlPattern: 'https://www.saucedemo.com/',
      role: 'search-entry',
      availableSignals: [],
      fingerprint: ['textbox:Username', 'button:Login'],
    },
    {
      id: 'sd:inventory',
      nodeId: 'saucedemo',
      semanticName: 'sd:inventory',
      urlPattern: '*inventory*',
      role: 'detail',
      availableSignals: [],
      fingerprint: ['button:Add to cart'],
    },
    {
      id: 'sd:cart',
      nodeId: 'saucedemo',
      semanticName: 'sd:cart',
      urlPattern: '*cart*',
      role: 'detail',
      availableSignals: ['cart_items'],
      fingerprint: ['button:Checkout'],
    },
    {
      id: 'sd:checkout-info',
      nodeId: 'saucedemo',
      semanticName: 'sd:checkout-info',
      urlPattern: '*checkout-step-one*',
      role: 'detail',
      availableSignals: [],
      fingerprint: ['textbox:First Name', 'button:Continue'],
    },
    {
      id: 'sd:checkout-overview',
      nodeId: 'saucedemo',
      semanticName: 'sd:checkout-overview',
      urlPattern: '*checkout-step-two*',
      role: 'detail',
      availableSignals: ['total'],
      fingerprint: ['button:Finish'],
    },
  ],
  edges: [
    // login -> inventory: multi-field login (username + password + click) modeled
    // as ONE edge whose intent is "log in". KNOWN SIMPLIFICATION: a single edge
    // represents the whole login transition; the live browser fills both fields
    // from the `credentials` slot. In the unit test the scripted browser just
    // advances the snapshot.
    // semanticStep quotes the durable target element name so the deterministic
    // resolver (resolveStep) re-resolves it against the live snapshot — the design's
    // deterministic-first contract (§3). The prose carries the intent; the quoted
    // token is the element resolveStep keys on.
    makeEdge({
      fromState: 'sd:login',
      toState: 'sd:inventory',
      semanticStep: 'log in by clicking "Login"',
      kind: 'safe-reversible',
      acceptsInput: 'credentials',
    }),
    makeEdge({
      fromState: 'sd:inventory',
      toState: 'sd:cart',
      // Target a SPECIFIC product by its unique link name: every product's button
      // is just "Add to cart" (not unique → resolveStep correctly escalates rather
      // than guess which of 6). A real route targets a specific item; "Sauce Labs
      // Backpack" is the canonical first product on saucedemo.
      semanticStep: 'add the "Sauce Labs Backpack" to cart and open cart',
      kind: 'safe-reversible',
    }),
    makeEdge({
      fromState: 'sd:cart',
      toState: 'sd:checkout-info',
      semanticStep: 'click "Checkout"',
      kind: 'safe-reversible',
    }),
    makeEdge({
      fromState: 'sd:checkout-info',
      toState: 'sd:checkout-overview',
      semanticStep: 'enter shipping info and continue via "Continue"',
      kind: 'safe-reversible',
      acceptsInput: 'shipping',
    }),
    // checkout-overview -> purchase-complete: the COMMIT POINT. Tagged `unclassified`
    // so replayStep returns `needs-classify` and the walk HALTS — webnav must never
    // fire Finish (principle #2). `sd:purchase-complete` is the goal target only; it
    // is intentionally NOT a fingerprinted state (webnav never observes past Finish).
    makeEdge({
      fromState: 'sd:checkout-overview',
      toState: 'sd:purchase-complete',
      semanticStep: 'click "Finish"',
      kind: 'unclassified',
    }),
  ],
};

/**
 * Persist the known saucedemo skeleton into MapStore. Synchronous, no browser.
 *
 * Idempotent: `upsertState` (ON CONFLICT id) and `upsertEdge`
 * (UNIQUE from_state,to_state,semantic_step) update rather than duplicate.
 */
export function exploreSaucedemo(store: MapStore): void {
  // Atomic: states + edges commit together so a crash can never leave a torn skeleton.
  store.transaction(() => {
    for (const state of SAUCEDEMO_SKELETON.states) {
      store.upsertState(state);
    }
    for (const edge of SAUCEDEMO_SKELETON.edges) {
      store.upsertEdge(edge);
    }
  });
}
