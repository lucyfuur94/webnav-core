import { PlaywrightAdapter } from '../playwright/adapter.js';
import { MapStore } from '../mapstore/store.js';
import { parseSnapshot, findByRoleAndName } from '../playwright/snapshot.js';
import { makeState, makeAffordance } from '../mapstore/types.js';
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
  const N = 'www.saucedemo.com';
  store.transaction(() => {
    // Each state's REPERTOIRE is the source of truth (spec §8). navigate/reveal
    // affordances with a toState project into the walk's edges; mutate/input never
    // route (they're fired by the agent at a pause if it wants them). The "Finish"
    // affordance is commit:true → it projects as a commit-point and is NEVER fired (#2).
    const states = [
      makeState({ id: `${N}:login`, nodeId: N, semanticName: `${N}:login`,
        urlPattern: 'https://www.saucedemo.com/', role: 'detail',
        fingerprint: ['textbox:Username', 'button:Login'],
        affordances: [
          makeAffordance({ id: 'aff_username', label: 'enter Username', kind: 'input' }),
          makeAffordance({ id: 'aff_password', label: 'enter Password', kind: 'input' }),
          makeAffordance({ id: 'aff_login', label: 'log in by clicking "Login"', kind: 'navigate',
            toState: `${N}:inventory`, needs: ['aff_username', 'aff_password'], acceptsInput: 'credentials', core: true }),
        ] }),
      makeState({ id: `${N}:inventory`, nodeId: N, semanticName: `${N}:inventory`,
        urlPattern: '*inventory*', role: 'detail', fingerprint: ['button:Add to cart'],
        affordances: [
          makeAffordance({ id: 'aff_cart', label: 'open the shopping cart', kind: 'navigate',
            toState: `${N}:cart`, addressableUrl: 'https://www.saucedemo.com/cart.html', core: true }),
          makeAffordance({ id: 'aff_sort', label: 'sort products', kind: 'mutate' }),
          makeAffordance({ id: 'aff_addcart', label: 'add an item to the cart', kind: 'mutate' }),
          makeAffordance({ id: 'aff_menu', label: 'open the burger menu', kind: 'reveal', children: [
            makeAffordance({ id: 'aff_allitems', label: 'All Items', kind: 'navigate', toState: `${N}:inventory` }),
            makeAffordance({ id: 'aff_about', label: 'About', kind: 'navigate', toState: null }), // unexplored (offsite)
            makeAffordance({ id: 'aff_logout', label: 'Logout', kind: 'navigate', toState: `${N}:login` }),
            makeAffordance({ id: 'aff_reset', label: 'Reset App State', kind: 'mutate' }),
          ] }),
        ] }),
      makeState({ id: `${N}:cart`, nodeId: N, semanticName: `${N}:cart`,
        urlPattern: '*cart*', role: 'detail', fingerprint: ['button:Checkout'],
        affordances: [
          makeAffordance({ id: 'aff_checkout', label: 'click "Checkout"', kind: 'navigate',
            toState: `${N}:checkout-info`, core: true }),
          makeAffordance({ id: 'aff_continue_shopping', label: 'Continue Shopping', kind: 'navigate',
            toState: `${N}:inventory` }),
        ] }),
      makeState({ id: `${N}:checkout-info`, nodeId: N, semanticName: `${N}:checkout-info`,
        urlPattern: '*checkout-step-one*', role: 'detail', fingerprint: ['textbox:First Name', 'button:Continue'],
        affordances: [
          makeAffordance({ id: 'aff_first', label: 'enter First Name', kind: 'input' }),
          makeAffordance({ id: 'aff_last', label: 'enter Last Name', kind: 'input' }),
          makeAffordance({ id: 'aff_zip', label: 'enter Zip/Postal Code', kind: 'input' }),
          makeAffordance({ id: 'aff_continue', label: 'click "Continue"', kind: 'navigate',
            toState: `${N}:checkout-overview`, needs: ['aff_first', 'aff_last', 'aff_zip'], acceptsInput: 'shipping', core: true }),
        ] }),
      makeState({ id: `${N}:checkout-overview`, nodeId: N, semanticName: `${N}:checkout-overview`,
        urlPattern: '*checkout-step-two*', role: 'detail', fingerprint: ['button:Finish'],
        affordances: [
          makeAffordance({ id: 'aff_finish', label: 'click "Finish"', kind: 'navigate',
            toState: `${N}:purchase-complete`, commit: true }),
        ] }),
    ];
    for (const s of states) store.upsertState(s);
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
    goto: async (url: string) => { await adapter.goto(url); },
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
    // Tier-1 addressable jump: the walk calls this for an edge with addressableUrl
    // (the cart link is icon-only / unstable on saucedemo, but cart.html is canonical).
    goto: async (url: string) => { await adapter.goto(url); },
    act: async (ref: string, inputSlot: string | null) => {
      if (inputSlot === 'credentials') {
        // LOGIN edge: replayStep resolved `ref` to the "Login" button. Fill
        // Username + Password first, then click.
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
      // Plain-click edge (e.g. cart -> checkout-info "Checkout"): click the resolved ref.
      await adapter.click(ref);
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
