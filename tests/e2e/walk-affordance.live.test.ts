import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { findPath } from '../../src/router/path.js';
import { walkRoute } from '../../src/router/walk.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { makeLiveWalkBrowser, seedSaucedemoForWalk } from '../../src/router/walk-live.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: saucedemo walk traverses the full typed-affordance route', () => {
  it('finds the path login->checkout-overview and walks it to completion (no escalation)', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    seedSaucedemoForWalk(store);
    // The path is PROJECTED from affordances (no stored edges seeded).
    const path = findPath(store, 'www.saucedemo.com:login', 'www.saucedemo.com:checkout-overview')!;
    expect(path[0]).toBe('www.saucedemo.com:login');
    expect(path[path.length - 1]).toBe('www.saucedemo.com:checkout-overview');
    // Short session id: the playwright-cli unix-socket path has a ~104-char limit on
    // macOS and a long temp-dir prefix, so a long session id overflows it (EINVAL).
    const adapter = new PlaywrightAdapter('sda' + (Date.now() % 100000));
    await adapter.open('https://www.saucedemo.com/');
    const browser = makeLiveWalkBrowser(adapter, {
      username: 'standard_user', password: 'secret_sauce',
      firstName: 'Test', lastName: 'User', zip: '12345',
    });
    const res = await walkRoute({
      goalName: 'sd', startStateId: 'www.saucedemo.com:login', goalStateId: 'www.saucedemo.com:checkout-overview',
      store, states: store.statesForNode('www.saucedemo.com'), browser, path,
    });
    await adapter.close().catch(() => {});
    // Auto-fill credentials, jump to the addressable cart, click Checkout, auto-fill
    // shipping, click Continue → arrive at checkout-overview and halt before Finish.
    expect(res.status).toBe('done');
  }, 120_000);
});
