import { PlaywrightAdapter } from '../playwright/adapter.js';
import { MapStore } from '../mapstore/store.js';
import { parseSnapshot, findByRoleAndName } from '../playwright/snapshot.js';
import { makeState, makeEdge } from '../mapstore/types.js';
import { walkRoute, type WalkBrowser } from './walk.js';
import type { RecallResponse } from '../protocol.js';

/**
 * Seed the `www.saucedemo.com` page-states + navigation edges inline (STRUCTURE
 * ONLY, principle #6 — no credentials/names/zips; those are runtime, supplied by
 * the live browser closure). This replaces the old hand-seeded saucedemo skeleton:
 * saucedemo is now an agent-built `www.saucedemo.com` graph, and the multi-step
 * walk seeds its interior inline here for the live wiring + gated e2es.
 *
 * Idempotent: upsertState (ON CONFLICT id) and upsertEdge (UNIQUE from,to,step).
 */
export function seedSaucedemoForWalk(store: MapStore): void {
  store.transaction(() => {
    const states = [
      makeState({ id: 'www.saucedemo.com:login', nodeId: 'www.saucedemo.com',
        semanticName: 'www.saucedemo.com:login', urlPattern: 'https://www.saucedemo.com/',
        role: 'detail', fingerprint: ['textbox:Username', 'button:Login'] }),
      makeState({ id: 'www.saucedemo.com:inventory', nodeId: 'www.saucedemo.com',
        semanticName: 'www.saucedemo.com:inventory', urlPattern: '*inventory*',
        role: 'detail', fingerprint: ['button:Add to cart'] }),
      makeState({ id: 'www.saucedemo.com:cart', nodeId: 'www.saucedemo.com',
        semanticName: 'www.saucedemo.com:cart', urlPattern: '*cart*',
        role: 'detail', fingerprint: ['button:Checkout'] }),
      makeState({ id: 'www.saucedemo.com:checkout-info', nodeId: 'www.saucedemo.com',
        semanticName: 'www.saucedemo.com:checkout-info', urlPattern: '*checkout-step-one*',
        role: 'detail', fingerprint: ['textbox:First Name', 'button:Continue'] }),
      makeState({ id: 'www.saucedemo.com:checkout-overview', nodeId: 'www.saucedemo.com',
        semanticName: 'www.saucedemo.com:checkout-overview', urlPattern: '*checkout-step-two*',
        role: 'detail', fingerprint: ['button:Finish'] }),
    ];
    const edges = [
      makeEdge({ fromState: 'www.saucedemo.com:login', toState: 'www.saucedemo.com:inventory',
        semanticStep: 'log in by clicking "Login"', kind: 'safe-reversible', acceptsInput: 'credentials' }),
      makeEdge({ fromState: 'www.saucedemo.com:inventory', toState: 'www.saucedemo.com:cart',
        semanticStep: 'open the shopping cart', kind: 'safe-reversible',
        requiresAffordances: ['add an item to the cart'] }),
      makeEdge({ fromState: 'www.saucedemo.com:cart', toState: 'www.saucedemo.com:checkout-info',
        semanticStep: 'click "Checkout"', kind: 'safe-reversible' }),
      makeEdge({ fromState: 'www.saucedemo.com:checkout-info', toState: 'www.saucedemo.com:checkout-overview',
        semanticStep: 'click "Continue"', kind: 'safe-reversible',
        requiresAffordances: ['enter First Name', 'enter Last Name', 'enter Zip/Postal Code'] }),
      makeEdge({ fromState: 'www.saucedemo.com:checkout-overview', toState: 'www.saucedemo.com:purchase-complete',
        semanticStep: 'click "Finish"', kind: 'unclassified' }),
    ];
    for (const s of states) store.upsertState(s);
    for (const e of edges) store.upsertEdge(e);
  });
}

/**
 * Build a live WalkBrowser over a playwright adapter, resolving each edge's input
 * slot from `inputs` at fill time. `inputs` is held only in memory here — never
 * persisted. Shared by runWalkLive and the walk / walk-resume CLI verbs.
 */
export function makeLiveWalkBrowser(
  adapter: PlaywrightAdapter,
  inputs: Record<string, string>,
): WalkBrowser {
  let lastSnapshot = '';
  async function fieldRef(name: string): Promise<string> {
    let nodes = parseSnapshot(lastSnapshot);
    let node = findByRoleAndName(nodes, 'textbox', name);
    if (!node || !node.ref) {
      lastSnapshot = await adapter.snapshot();
      nodes = parseSnapshot(lastSnapshot);
      node = findByRoleAndName(nodes, 'textbox', name);
    }
    if (!node || !node.ref) throw new Error('walk: could not resolve textbox "' + name + '"');
    return node.ref;
  }
  return {
    snapshot: async () => {
      lastSnapshot = await adapter.snapshot();
      return lastSnapshot;
    },
    callCount: () => adapter.callCount,
    act: async (ref: string, inputSlot: string | null) => {
      if (inputSlot === 'credentials') {
        await adapter.fill(await fieldRef('Username'), inputs.username);
        await adapter.fill(await fieldRef('Password'), inputs.password);
        await adapter.click(ref);
        return;
      }
      if (inputSlot === 'shipping') {
        await adapter.fill(await fieldRef('First Name'), inputs.firstName ?? 'A');
        await adapter.fill(await fieldRef('Last Name'), inputs.lastName ?? 'B');
        await adapter.fill(await fieldRef('Zip/Postal Code'), inputs.zip);
        await adapter.click(ref);
        return;
      }
      await adapter.click(ref);
    },
  };
}

/**
 * Live wiring for the saucedemo multi-step walk (increment W2).
 *
 * Drives the REAL PlaywrightAdapter against live saucedemo.com through the SAME
 * async `walkRoute` loop the unit test exercises (zero duplicated loop logic).
 *
 * The walk is runtime-value-free: it only passes each edge's `acceptsInput` slot
 * NAME to `act`. THIS closure owns the `inputs` map and resolves slot -> value(s)
 * when filling fields (principle #6: inputs are runtime, never stored as map).
 *
 * Goal is `www.saucedemo.com:checkout-overview` (a PASS-THROUGH state), so the walk
 * HALTS there and returns `done` WITHOUT ever attempting the next edge — the
 * unclassified "Finish" commit point is never fired (principle #2).
 */
export async function runWalkLive(
  inputs: Record<string, string>,
  dbPath?: string,
): Promise<RecallResponse> {
  // 1. File-backed MapStore; DB is authoritative — the saucedemo interior is written
  //    inline here (saucedemo is no longer part of the seeded graph). If it's absent,
  //    the walk seeds it once (the single bootstrap).
  const store = new MapStore(dbPath ?? 'webnav.db');
  if (!store.getState('www.saucedemo.com:checkout-overview')) {
    seedSaucedemoForWalk(store);
  }

  // 2. Open a real browser session on the saucedemo login page.
  const adapter = new PlaywrightAdapter('sd-' + Date.now());
  await adapter.open('https://www.saucedemo.com/');

  // Cache the most recent snapshot so `act` can resolve input fields by role+name
  // WITHOUT an extra playwright call. The walk always snapshots immediately before
  // calling act() (the top-of-loop read), so `lastSnapshot` is the current page.
  let lastSnapshot = '';

  // Resolve a textbox ref by its accessible name on the current (cached) page.
  // Falls back to a fresh snapshot if the cache is somehow empty (counts as a call).
  async function fieldRef(name: string): Promise<string> {
    let nodes = parseSnapshot(lastSnapshot);
    let node = findByRoleAndName(nodes, 'textbox', name);
    if (!node || !node.ref) {
      lastSnapshot = await adapter.snapshot();
      nodes = parseSnapshot(lastSnapshot);
      node = findByRoleAndName(nodes, 'textbox', name);
    }
    if (!node || !node.ref) {
      throw new Error('walk-live: could not resolve textbox "' + name + '" on current page');
    }
    return node.ref;
  }

  // 3. Build the live WalkBrowser. `act` performs the per-edge field-fills BEFORE
  //    the resolved click. saucedemo steps are multi-field, so a single edge's act
  //    fans out into several adapter calls — the walk stays a single linear loop.
  const browser: WalkBrowser = {
    snapshot: async () => {
      lastSnapshot = await adapter.snapshot();
      return lastSnapshot;
    },
    callCount: () => adapter.callCount,
    act: async (ref: string, inputSlot: string | null) => {
      if (inputSlot === 'credentials') {
        // LOGIN edge: replayStep resolved `ref` to the "Login" button (the W1
        // semanticStep quotes "Login"). Fill Username + Password first, then click.
        const userRef = await fieldRef('Username');
        const passRef = await fieldRef('Password');
        await adapter.fill(userRef, inputs.username);
        await adapter.fill(passRef, inputs.password);
        await adapter.click(ref);
        return;
      }
      if (inputSlot === 'shipping') {
        // SHIPPING edge (checkout-step-one): fill the three address fields, then
        // click `ref` (the resolved "Continue" button).
        const firstRef = await fieldRef('First Name');
        const lastRef = await fieldRef('Last Name');
        const zipRef = await fieldRef('Zip/Postal Code');
        await adapter.fill(firstRef, inputs.firstName);
        await adapter.fill(lastRef, inputs.lastName);
        await adapter.fill(zipRef, inputs.zip);
        await adapter.click(ref);
        return;
      }
      // Null-input edges:
      //  - inventory -> cart: the edge's semanticStep targets a SPECIFIC product
      //    ("Sauce Labs Backpack"), so `ref` is that unique product LINK. But the
      //    action we want is its "Add to cart" BUTTON. On saucedemo each product
      //    card has its own "Add to cart"; we click the FIRST one (the Backpack is
      //    the first card), then reach the cart. TWO-ACTION SIMPLIFICATION (honest
      //    seam): add-to-cart doesn't navigate, and cart IS url-addressable, so we
      //    goto cart.html rather than hunt the cart-badge link (more robust). Per
      //    the coordinate system an addressable state may be jumped to — acceptable.
      //  - cart -> checkout-info: `ref` is the "Checkout" button — just click it.
      const addBtn = parseSnapshot(lastSnapshot).find(
        (n) => n.role === 'button' && n.name === 'Add to cart' && n.ref,
      );
      if (addBtn?.ref) {
        // inventory -> cart: click the (first) Add-to-cart button, then go to cart.
        await adapter.click(addBtn.ref);
        await adapter.goto('https://www.saucedemo.com/cart.html');
      } else {
        // cart -> checkout-info (or any other plain-click edge): click the resolved ref.
        await adapter.click(ref);
      }
    },
  };

  // 4. Walk login -> checkout-overview through the ONE async loop. Note: `inputs`
  //    is captured by the browser closure above, NOT passed into walkRoute (it was
  //    removed from WalkArgs — the walk only forwards the acceptsInput slot name).
  const result = await walkRoute({
    goalName: 'complete-checkout-dryrun',
    startStateId: 'www.saucedemo.com:login',
    goalStateId: 'www.saucedemo.com:checkout-overview',
    store,
    states: store.statesForNode('www.saucedemo.com'),
    browser,
  });

  // 5. Always close the browser session, then return the walk result.
  await adapter.close();
  return result;
}
