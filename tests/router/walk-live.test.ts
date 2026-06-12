import { describe, it, expect, vi } from 'vitest';
import { makeLiveWalkBrowser, seedSaucedemoForWalk, seedSaucedemoComplete } from '../../src/router/walk-live.js';
import { MapStore } from '../../src/mapstore/store.js';
import type { PlaywrightAdapter } from '../../src/playwright/adapter.js';

const N = 'www.saucedemo.com';

const LOGIN_PAGE = [
  '- textbox "Username" [ref=e1]',
  '- textbox "Password" [ref=e2]',
  '- button "Login" [ref=e3]',
].join('\n');

const SHIPPING_PAGE = [
  '- textbox "First Name" [ref=e10]',
  '- textbox "Last Name" [ref=e11]',
  '- textbox "Zip/Postal Code" [ref=e12]',
  '- button "Continue" [ref=e13]',
].join('\n');

// FAKE adapter: records every call in order; snapshot() serves one scripted page.
// No child processes, no playwright-cli.
function fakeAdapter(page: string) {
  const calls: string[][] = [];
  const adapter = {
    callCount: 0,
    calls,
    snapshot: vi.fn(async () => { adapter.callCount++; calls.push(['snapshot']); return page; }),
    click: vi.fn(async (ref: string) => { adapter.callCount++; calls.push(['click', ref]); }),
    fill: vi.fn(async (ref: string, text: string) => { adapter.callCount++; calls.push(['fill', ref, text]); }),
    goto: vi.fn(async (url: string) => { adapter.callCount++; calls.push(['goto', url]); }),
  };
  return adapter;
}
const asAdapter = (a: ReturnType<typeof fakeAdapter>) => a as unknown as PlaywrightAdapter;

describe('makeLiveWalkBrowser', () => {
  it('snapshot() proxies the adapter and callCount() mirrors adapter.callCount', async () => {
    const adapter = fakeAdapter(LOGIN_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter), {});
    expect(await browser.snapshot()).toBe(LOGIN_PAGE);
    expect(browser.callCount()).toBe(adapter.callCount);
    expect(browser.callCount()).toBe(1);
  });

  it('goto() delegates the tier-1 addressable jump to the adapter', async () => {
    const adapter = fakeAdapter(LOGIN_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter), {});
    await browser.goto!('https://www.saucedemo.com/cart.html');
    expect(adapter.calls).toEqual([['goto', 'https://www.saucedemo.com/cart.html']]);
  });

  it('act(ref, null) is a plain click — no fills, no extra snapshots', async () => {
    const adapter = fakeAdapter(LOGIN_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter), {});
    await browser.act('e3', null);
    expect(adapter.calls).toEqual([['click', 'e3']]);
  });

  it('act(ref, "credentials") fills Username+Password from inputs, then clicks the resolved ref', async () => {
    const adapter = fakeAdapter(LOGIN_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter),
      { username: 'standard_user', password: 'secret_sauce' });
    await browser.snapshot();   // the walk always snapshots before acting
    await browser.act('e3', 'credentials');
    expect(adapter.calls).toEqual([
      ['snapshot'],                              // the top-of-loop read
      ['fill', 'e1', 'standard_user'],
      ['fill', 'e2', 'secret_sauce'],
      ['click', 'e3'],                           // click LAST, after the fills
    ]);
    // Field refs resolve from the CACHED snapshot — no re-snapshot during act.
    expect(adapter.snapshot).toHaveBeenCalledTimes(1);
  });

  it('falls back to a fresh snapshot when no snapshot is cached yet', async () => {
    const adapter = fakeAdapter(LOGIN_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter), { username: 'u', password: 'p' });
    await browser.act('e3', 'credentials');      // act WITHOUT a prior snapshot
    // One retry snapshot to populate the cache, then both fields resolve from it.
    expect(adapter.calls).toEqual([
      ['snapshot'],
      ['fill', 'e1', 'u'],
      ['fill', 'e2', 'p'],
      ['click', 'e3'],
    ]);
  });

  it('act(ref, "shipping") fills the three address fields, defaulting first/last name', async () => {
    const adapter = fakeAdapter(SHIPPING_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter), { zip: '560001' });
    await browser.snapshot();
    await browser.act('e13', 'shipping');
    expect(adapter.calls.slice(1)).toEqual([
      ['fill', 'e10', 'A'],                      // firstName default
      ['fill', 'e11', 'B'],                      // lastName default
      ['fill', 'e12', '560001'],
      ['click', 'e13'],
    ]);
  });

  it('uses supplied shipping inputs over the defaults', async () => {
    const adapter = fakeAdapter(SHIPPING_PAGE);
    const browser = makeLiveWalkBrowser(asAdapter(adapter),
      { firstName: 'Ada', lastName: 'Lovelace', zip: '12345' });
    await browser.snapshot();
    await browser.act('e13', 'shipping');
    expect(adapter.calls.slice(1, 4)).toEqual([
      ['fill', 'e10', 'Ada'],
      ['fill', 'e11', 'Lovelace'],
      ['fill', 'e12', '12345'],
    ]);
  });

  it('throws when a required textbox is missing from the live page (after one retry snapshot)', async () => {
    const adapter = fakeAdapter('- button "Login" [ref=e3]');   // no Username textbox
    const browser = makeLiveWalkBrowser(asAdapter(adapter), { username: 'u', password: 'p' });
    await browser.snapshot();
    await expect(browser.act('e3', 'credentials'))
      .rejects.toThrow(/could not resolve textbox "Username"/);
    // It re-snapshots ONCE on the cache miss before giving up; never clicks.
    expect(adapter.snapshot).toHaveBeenCalledTimes(2);
    expect(adapter.click).not.toHaveBeenCalled();
  });
});

describe('seedSaucedemoForWalk', () => {
  it('seeds the saucedemo node + its five interior states', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoForWalk(store);
    expect(store.getNode(N)?.homeUrl).toBe('https://www.saucedemo.com/');
    expect(store.statesForNode(N).map((s) => s.id).sort()).toEqual([
      `${N}:cart`, `${N}:checkout-info`, `${N}:checkout-overview`, `${N}:inventory`, `${N}:login`,
    ]);
  });

  it('projects login -> inventory with acceptsInput, and needs are NOT a pause gate', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoForWalk(store);
    const edges = store.edgesFrom(`${N}:login`);
    expect(edges).toHaveLength(1);   // the two input affordances never project
    expect(edges[0].toState).toBe(`${N}:inventory`);
    expect(edges[0].acceptsInput).toBe('credentials');
    expect(edges[0].requiresAffordances).toEqual([]);   // auto-filled, not a gate
  });

  it('inventory projects the cart jump (addressableUrl) + reveal children, never mutate/input', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoForWalk(store);
    const edges = store.edgesFrom(`${N}:inventory`);
    const cart = edges.find((e) => e.toState === `${N}:cart`);
    expect(cart?.addressableUrl).toBe('https://www.saucedemo.com/cart.html');
    // Reveal CHILDREN with a toState project (Logout, All Items); the unexplored
    // About (toState null) and the mutate affordances (sort/add-to-cart/reset) don't.
    expect(edges.map((e) => e.semanticStep).sort()).toEqual(
      ['All Items', 'Logout', 'open the shopping cart']);
    expect(edges.find((e) => e.semanticStep === 'Logout')?.toState).toBe(`${N}:login`);
  });

  it('projects the Finish affordance as a commit-point edge (never auto-fired)', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoForWalk(store);
    const edges = store.edgesFrom(`${N}:checkout-overview`);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('commit-point');
    expect(edges[0].toState).toBe(`${N}:purchase-complete`);
  });

  it('is idempotent: re-seeding changes nothing', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoForWalk(store);
    seedSaucedemoForWalk(store);
    expect(store.statesForNode(N)).toHaveLength(5);
    expect(store.edgesFrom(`${N}:inventory`)).toHaveLength(3);
  });
});

describe('seedSaucedemoComplete', () => {
  it('re-points Finish at a real checkout-complete state (still a commit point)', () => {
    const store = new MapStore(':memory:');
    seedSaucedemoComplete(store);
    expect(store.statesForNode(N)).toHaveLength(6);
    expect(store.getState(`${N}:checkout-complete`)).not.toBeNull();
    const edges = store.edgesFrom(`${N}:checkout-overview`);
    expect(edges).toHaveLength(1);
    expect(edges[0].toState).toBe(`${N}:checkout-complete`);
    expect(edges[0].kind).toBe('commit-point');
    // The post-commit state can navigate Back Home -> inventory.
    expect(store.edgesFrom(`${N}:checkout-complete`)[0].toState).toBe(`${N}:inventory`);
  });
});
