import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';

const BEFORE = '- button "Add to cart" [ref=e1]';
const AFTER = '- button "Remove" [ref=e1b]\n- generic "1" [ref=e2]';

function fake(after: string, toUrl: string) {
  return {
    open: async () => '',
    snapshot: async () => after,
    close: async () => '',
    act: async () => {},
    currentUrl: async () => toUrl,
  };
}

describe('runActionRecorded', () => {
  it('records an in-page action-effect (navigated=false, diff captured)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const r = await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
      action: { role: 'button', name: 'Add to cart', ref: 'e1' },
      adapter: fake(AFTER, 'https://x.com/inventory.html') as any,
    });
    expect(r.recorded).toBe(true);
    const fx = rec.actionEffects('s');
    expect(fx).toHaveLength(1);
    expect(fx[0].navigated).toBe(false);
    expect(fx[0].diff.added.map((n) => n.name)).toEqual(expect.arrayContaining(['Remove', '1']));
    expect(fx[0].diff.removed.map((n) => n.name)).toEqual(['Add to cart']);
  });

  it('records a navigation action-effect (navigated=true)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    // >=8 nodes with content roles so classifyReadiness sees 'ready' (not 'loading') —
    // otherwise the settle loop (gated on navigated=true) retries 3x700ms real time.
    const CART_PAGE = '- heading "Your Cart" [ref=e3]\n- link "Continue Shopping" [ref=e4]\n'
      + '- button "Checkout" [ref=e5]\n- listitem "Item 1" [ref=e6]\n- listitem "Item 2" [ref=e7]\n'
      + '- button "Remove" [ref=e8]\n- link "Home" [ref=e9]\n- paragraph "2 items" [ref=e10]';
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
      action: { role: 'link', name: 'cart', ref: 'e9' },
      adapter: fake(CART_PAGE, 'https://x.com/cart.html') as any,
    });
    expect(rec.actionEffects('s')[0].navigated).toBe(true);
  });

  it('settles a navigated action: retries a loading snapshot before recording (bounded)', async () => {
    vi.useFakeTimers();
    try {
      const rec = RecordStore.fromDatabase(new Database(':memory:'));
      rec.start('s');
      const snaps = ['- generic "spinner"', '- heading "Your Cart" [ref=e3]\n- link "Continue Shopping" [ref=e4]\n'
        + '- button "Checkout" [ref=e5]\n- listitem "Item 1" [ref=e6]\n- listitem "Item 2" [ref=e7]\n'
        + '- button "Remove" [ref=e8]\n- link "Home" [ref=e9]\n- paragraph "2 items" [ref=e10]'];
      let call = 0;
      const adapter = {
        open: async () => '', close: async () => '', act: async () => {},
        snapshot: async () => snaps[Math.min(call++, snaps.length - 1)],
        currentUrl: async () => 'https://x.com/cart.html',
      };
      const done = runActionRecorded({
        sessionId: 's', recordStore: rec,
        fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
        action: { role: 'link', name: 'cart', ref: 'e9' },
        adapter: adapter as any,
      });
      await vi.runAllTimersAsync();
      await done;
      const fx = rec.actionEffects('s')[0];
      expect(fx.navigated).toBe(true);
      expect(fx.toSnapshot).toContain('Your Cart');   // settled snapshot, not the spinner
    } finally {
      vi.useRealTimers();
    }
  });
});
