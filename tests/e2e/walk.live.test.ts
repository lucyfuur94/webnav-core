import { describe, it, expect } from 'vitest';

// Gated: only runs when WEBNAV_LIVE=1 (the controller drives this against a real
// browser + live saucedemo.com). Default `vitest` runs skip it.
const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live saucedemo multi-step walk', () => {
  it('logs in, walks to inventory, and correctly escalates at the ambiguous add-to-cart step', async () => {
    const { runWalkLive } = await import('../../src/router/walk-live.js');
    const r = await runWalkLive({
      username: 'standard_user', password: 'secret_sauce',
      firstName: 'Test', lastName: 'User', zip: '12345',
    }, '/tmp/webnav-sd-e2e.db');

    // The multi-step walk really runs: it logs in (multi-field fill + click) and
    // reaches the inventory page. The inventory->cart step targets "Add to cart",
    // of which there are 6 EQUIVALENT buttons — webnav correctly REFUSES to guess
    // and escalates needs-navigation to the agent (principle #5a). This proves the
    // live multi-step walk + per-step verification + the escalation path, end to
    // end, against a real site. (It never fires a commit point.)
    expect(r.status).toBe('needs-navigation');
    if (r.status === 'needs-navigation') {
      expect(r.at).toBe(1);                          // escalated AFTER login (step 1)
      expect(r.semanticStep).toMatch(/cart/i);       // the add-to-cart step
      expect(r.snapshot).toMatch(/Add to cart/);     // we really reached inventory
    }
  }, 120000);
});
