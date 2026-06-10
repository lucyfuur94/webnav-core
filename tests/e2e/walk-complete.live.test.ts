import { describe, it, expect } from 'vitest';

// Gated (WEBNAV_LIVE=1): drives the FULL order completion against live saucedemo,
// including firing the "Finish" commit via the R5 resume loop. saucedemo is a demo
// with no real payment, so the agent classifies Finish SAFE and the walk continues
// to the checkout-complete "Thank you" page.
const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live saucedemo FULL order completion (R5 resume through the commit)', () => {
  it('walks login → … → checkout-overview, classifies Finish safe, reaches checkout-complete', async () => {
    const { runWalkLiveComplete } = await import('../../src/router/walk-live.js');
    const r = await runWalkLiveComplete({
      username: 'standard_user', password: 'secret_sauce',
      firstName: 'Test', lastName: 'User', zip: '12345',
    }, '/tmp/webnav-sd-complete.db');

    // The walk halted at the Finish commit, the agent answered "safe", and the
    // resume fired Finish → reached checkout-complete. This proves a commit point
    // CAN be traversed end-to-end on a real site, but ONLY via explicit classification.
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.evidence.goal).toBe('complete-checkout');
      // it did NOT hard-halt — it actually completed.
      expect((r as { halted?: string }).halted).toBeUndefined();
    }
  }, 120000);
});
