import { describe, it, expect } from 'vitest';

// Gated: only runs when WEBNAV_LIVE=1 (the controller drives this against a real
// browser + live saucedemo.com). Default `vitest` runs skip it.
const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live saucedemo multi-step walk', () => {
  it('walks login -> inventory -> cart -> checkout-info -> checkout-overview and HALTS before the Finish commit', async () => {
    const { runWalkLive } = await import('../../src/router/walk-live.js');
    const r = await runWalkLive({
      username: 'standard_user', password: 'secret_sauce',
      firstName: 'Test', lastName: 'User', zip: '12345',
    }, '/tmp/webnav-sd-e2e.db');

    // The full multi-step walk runs deterministically against the typed-affordance
    // saucedemo graph: login (auto-fill credentials + click "Login"), JUMP to the
    // URL-addressable cart (the cart icon has no stable accessible name), click
    // "Checkout", auto-fill shipping + click "Continue", and arrive at
    // checkout-overview. The goal state is checkout-overview (a PASS-THROUGH), so
    // the walk halts THERE and NEVER attempts the "Finish" commit point (#2).
    // add-to-cart is now a same-page `mutate` (not a gate): the empty cart is a
    // valid state, so the walk reaches it without pausing. This proves a complete,
    // zero-escalation autopilot walk end-to-end on a real site.
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.evidence.goal).toBe('complete-checkout-dryrun');
      expect(r.evidence.cost.playwright_calls).toBeGreaterThan(0);
    }
  }, 120000);
});
