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
      affordances: [],
    },
    {
      id: 'sd:inventory',
      nodeId: 'saucedemo',
      semanticName: 'sd:inventory',
      urlPattern: '*inventory*',
      role: 'detail',
      availableSignals: [],
      fingerprint: ['button:Add to cart'],
      affordances: ['add an item to the cart (e.g. the "Add to cart" button on a product)'],
    },
    {
      id: 'sd:cart',
      nodeId: 'saucedemo',
      semanticName: 'sd:cart',
      urlPattern: '*cart*',
      role: 'detail',
      availableSignals: ['cart_items'],
      fingerprint: ['button:Checkout'],
      affordances: [],
    },
    {
      id: 'sd:checkout-info',
      nodeId: 'saucedemo',
      semanticName: 'sd:checkout-info',
      urlPattern: '*checkout-step-one*',
      role: 'detail',
      availableSignals: [],
      fingerprint: ['textbox:First Name', 'button:Continue'],
      affordances: [],
    },
    {
      id: 'sd:checkout-overview',
      nodeId: 'saucedemo',
      semanticName: 'sd:checkout-overview',
      urlPattern: '*checkout-step-two*',
      role: 'detail',
      availableSignals: ['total'],
      fingerprint: ['button:Finish'],
      affordances: [],
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
      fromState: 'sd:login', toState: 'sd:inventory',
      semanticStep: 'log in by clicking "Login"',
      kind: 'safe-reversible', acceptsInput: 'credentials',
    }),
    // inventory -> cart: just OPEN the cart. Adding an item is a precondition the
    // calling agent must satisfy (no unique "Add to cart" button to target — 6
    // identical ones), so it is declared as a required affordance, NOT bundled into
    // this edge's semanticStep. Keeps the edge a pure navigation transition (#6).
    makeEdge({
      fromState: 'sd:inventory', toState: 'sd:cart',
      semanticStep: 'open the shopping cart',
      kind: 'safe-reversible',
      requiresAffordances: ['add an item to the cart (e.g. the "Add to cart" button on a product)'],
    }),
    makeEdge({
      fromState: 'sd:cart', toState: 'sd:checkout-info',
      semanticStep: 'click "Checkout"', kind: 'safe-reversible',
    }),
    // checkout-info -> checkout-overview: just click "Continue". Filling the shipping
    // fields is a precondition declared as required affordances (was the `shipping`
    // input slot) — the agent supplies the values at walk time; the edge stays pure.
    makeEdge({
      fromState: 'sd:checkout-info', toState: 'sd:checkout-overview',
      semanticStep: 'click "Continue"', kind: 'safe-reversible',
      requiresAffordances: ['enter First Name', 'enter Last Name', 'enter Zip/Postal Code'],
    }),
    // checkout-overview -> purchase-complete: the COMMIT POINT. Tagged `unclassified`
    // so replayStep returns `needs-classify` and the walk HALTS — webnav must never
    // fire Finish (principle #2). `sd:purchase-complete` is the goal target only; it
    // is intentionally NOT a fingerprinted state (webnav never observes past Finish).
    makeEdge({
      fromState: 'sd:checkout-overview', toState: 'sd:purchase-complete',
      semanticStep: 'click "Finish"', kind: 'unclassified',
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
    // Clear stale sd:* edges first so a re-seed over an existing DB cannot leave an
    // OLD bundled edge (e.g. the previous inventory→cart "add ... and open cart")
    // lingering alongside the new ones. States are re-upserted (same ids, idempotent).
    store.deleteEdgesFromPrefix('sd:');
    for (const state of SAUCEDEMO_SKELETON.states) {
      store.upsertState(state);
    }
    for (const edge of SAUCEDEMO_SKELETON.edges) {
      store.upsertEdge(edge);
    }
  });
}
