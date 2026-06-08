import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { findPath } from '../../src/router/path.js';
import { walkRoute } from '../../src/router/walk.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { makeLiveWalkBrowser, seedSaucedemoForWalk } from '../../src/router/walk-live.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: saucedemo walk pauses at the add-to-cart affordance', () => {
  it('logs in, reaches inventory, then pauses for the required add-to-cart affordance', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    seedSaucedemoForWalk(store);
    const path = findPath(store, 'www.saucedemo.com:login', 'www.saucedemo.com:checkout-overview')!;
    expect(path[0]).toBe('www.saucedemo.com:login');
    const adapter = new PlaywrightAdapter('aff-walk-' + Date.now());
    await adapter.open('https://www.saucedemo.com/');
    const browser = makeLiveWalkBrowser(adapter, { username: 'standard_user', password: 'secret_sauce' });
    const res = await walkRoute({
      goalName: 'sd', startStateId: 'www.saucedemo.com:login', goalStateId: 'www.saucedemo.com:checkout-overview',
      store, states: store.statesForNode('www.saucedemo.com'), browser, path,
    });
    await adapter.close().catch(() => {});
    // login resolves (needsInput credentials) then the walk pauses at the
    // inventory->cart edge for the required add-to-cart affordance.
    expect(res.status).toBe('needs-navigation');
    expect((res as any).question).toMatch(/add/i);
  }, 120_000);
});
