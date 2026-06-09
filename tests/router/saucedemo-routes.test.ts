import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';
import { findPath } from '../../src/router/path.js';

// Navigation TEST CASES over the FULL saucedemo map (the same complete graph we
// persisted to webnav.db, built here inline so the test is self-contained). Each
// case is a goal an agent would actually want; we assert findPath returns the
// expected route over the cyclic graph. This proves the stored graph SUPPORTS the
// navigation (routing layer); the gated live e2e then proves a walk TRAVERSES it.
const N = 'www.saucedemo.com';
const sid = (label: string) => `${N}:${label}`;

function fullSaucedemo(store: MapStore): void {
  editGraph(store, N, {
    node: { capabilities: ['shopping-demo'], topics: ['shopping'] },
    states: [
      { label: 'login', fingerprint: ['textbox:Username', 'button:Login'], affordances: [
        { id: 'aff_username', label: 'enter Username', kind: 'input' },
        { id: 'aff_password', label: 'enter Password', kind: 'input' },
        { id: 'aff_login', label: 'log in by clicking "Login"', kind: 'navigate', to: 'inventory',
          needs: ['aff_username', 'aff_password'], acceptsInput: 'credentials', core: true },
      ] },
      { label: 'inventory', fingerprint: ['button:Add to cart'], affordances: [
        { id: 'aff_cart', label: 'open the shopping cart', kind: 'navigate', to: 'cart',
          addressableUrl: 'https://www.saucedemo.com/cart.html', core: true },
        { id: 'aff_product', label: 'open product detail', kind: 'navigate', to: 'product-detail' },
        { id: 'aff_sort', label: 'sort products', kind: 'mutate' },
        { id: 'aff_addcart', label: 'add an item to the cart', kind: 'mutate' },
        { id: 'aff_menu', label: 'open the burger menu', kind: 'reveal', children: [
          { id: 'aff_allitems', label: 'All Items', kind: 'navigate', to: 'inventory' },
          { id: 'aff_about', label: 'About', kind: 'navigate', addressableUrl: 'https://saucelabs.com/' },
          { id: 'aff_logout', label: 'Logout', kind: 'navigate', to: 'login' },
          { id: 'aff_reset', label: 'Reset App State', kind: 'mutate' },
        ] },
      ] },
      { label: 'product-detail', fingerprint: ['button:Back to products'], affordances: [
        { id: 'aff_back_products', label: 'Back to products', kind: 'navigate', to: 'inventory' },
        { id: 'aff_pd_cart', label: 'open the shopping cart', kind: 'navigate', to: 'cart' },
        { id: 'aff_pd_addcart', label: 'add an item to the cart', kind: 'mutate' },
      ] },
      { label: 'cart', fingerprint: ['button:Checkout'], affordances: [
        { id: 'aff_checkout', label: 'click "Checkout"', kind: 'navigate', to: 'checkout-info', core: true },
        { id: 'aff_continue_shopping', label: 'Continue Shopping', kind: 'navigate', to: 'inventory' },
        { id: 'aff_remove', label: 'Remove an item', kind: 'mutate' },
      ] },
      { label: 'checkout-info', fingerprint: ['textbox:First Name', 'button:Continue'], affordances: [
        { id: 'aff_first', label: 'enter First Name', kind: 'input' },
        { id: 'aff_last', label: 'enter Last Name', kind: 'input' },
        { id: 'aff_zip', label: 'enter Zip/Postal Code', kind: 'input' },
        { id: 'aff_continue', label: 'click "Continue"', kind: 'navigate', to: 'checkout-overview',
          needs: ['aff_first', 'aff_last', 'aff_zip'], acceptsInput: 'shipping', core: true },
        { id: 'aff_ci_cancel', label: 'Cancel', kind: 'navigate', to: 'cart' },
      ] },
      { label: 'checkout-overview', fingerprint: ['button:Finish'], affordances: [
        { id: 'aff_finish', label: 'click "Finish"', kind: 'navigate', to: 'checkout-complete', commit: true, core: true },
        { id: 'aff_co_cancel', label: 'Cancel', kind: 'navigate', to: 'inventory' },
      ] },
      { label: 'checkout-complete', fingerprint: ['heading:Thank you for your order!'], affordances: [
        { id: 'aff_back_home', label: 'Back Home', kind: 'navigate', to: 'inventory' },
      ] },
    ],
    edges: [],
  });
}

let store: MapStore;
beforeAll(() => { store = MapStore.fromDatabase(new Database(':memory:')); fullSaucedemo(store); });

describe('saucedemo navigation test cases (findPath over the full map)', () => {
  // The labels each route should pass through (short form).
  const short = (ids: string[]) => ids.map((i) => i.slice(i.indexOf(':') + 1));

  it('TC1 — log in: login → inventory', () => {
    expect(short(findPath(store, sid('login'), sid('inventory'))!)).toEqual(['login', 'inventory']);
  });

  it('TC2 — full checkout journey: login → … → checkout-complete', () => {
    const p = short(findPath(store, sid('login'), sid('checkout-complete'))!);
    expect(p).toEqual(['login', 'inventory', 'cart', 'checkout-info', 'checkout-overview', 'checkout-complete']);
  });

  it('TC3 — view a product detail: login → inventory → product-detail (the state we used to miss)', () => {
    const p = short(findPath(store, sid('login'), sid('product-detail'))!);
    expect(p).toEqual(['login', 'inventory', 'product-detail']);
  });

  it('TC4 — reach the cart from a product detail (uses product-detail → cart edge)', () => {
    const p = short(findPath(store, sid('product-detail'), sid('cart'))!);
    expect(p).toEqual(['product-detail', 'cart']);
  });

  it('TC5 — log back out: inventory → login (a back-edge / cycle)', () => {
    // Logout lives in the burger-menu reveal; it still projects an inventory→login edge.
    const p = short(findPath(store, sid('inventory'), sid('login'))!);
    expect(p).toEqual(['inventory', 'login']);
  });

  it('TC6 — bail out of checkout: checkout-info → cart (Cancel back-edge)', () => {
    expect(short(findPath(store, sid('checkout-info'), sid('cart'))!)).toEqual(['checkout-info', 'cart']);
  });

  it('TC7 — after ordering, return to shop: checkout-complete → cart (Back Home → inventory → cart)', () => {
    const p = short(findPath(store, sid('checkout-complete'), sid('cart'))!);
    expect(p).toEqual(['checkout-complete', 'inventory', 'cart']);
  });

  it('every non-terminal state can reach checkout-overview (the goal the live walk targets)', () => {
    for (const label of ['login', 'inventory', 'product-detail', 'cart', 'checkout-info']) {
      const p = findPath(store, sid(label), sid('checkout-overview'));
      expect(p, `no route from ${label}`).not.toBeNull();
    }
  });
});
