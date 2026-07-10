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
    const fx = rec.actionEffects('s')[0];
    expect(fx.navigated).toBe(true);
    expect(fx.requestedUrl).toBeUndefined();   // clicked node declares no href → no requested url
  });

  it('records the clicked link\'s declared href (absolutized) as requestedUrl when it navigated', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    // OrangeHRM shape: sidebar link declares viewAdminModule; the server redirects
    // the click to viewSystemUsers — the declared href is the alias evidence.
    const FROM = '- link "Admin" [ref=e9]\n  - /url: /web/index.php/admin/viewAdminModule';
    const AFTER_ADMIN = '- heading "System Users" [ref=e3]\n- button "Add" [ref=e4]\n- button "Search" [ref=e5]\n'
      + '- textbox "Username" [ref=e6]\n- link "Dashboard" [ref=e7]\n- link "Admin" [ref=e8]\n'
      + '- cell "admin01" [ref=e10]\n- paragraph "Records Found" [ref=e11]';
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/web/index.php/dashboard/index', fromSnapshot: FROM,
      action: { role: 'link', name: 'Admin', ref: 'e9' },
      adapter: fake(AFTER_ADMIN, 'https://x.com/web/index.php/admin/viewSystemUsers') as any,
    });
    const fx = rec.actionEffects('s')[0];
    expect(fx.navigated).toBe(true);
    expect(fx.requestedUrl).toBe('https://x.com/web/index.php/admin/viewAdminModule');
  });

  it('does not record a fragment-only href as requestedUrl (declares no cross-page destination)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    // SPA link href="#": the click handler navigated, but the href points at the SAME
    // page — recording it would alias the from-page onto the to-page (state-merge poison).
    const FROM = '- link "Reports" [ref=e2]\n  - /url: #';
    const AFTER_R = '- heading "Reports" [ref=e3]\n- button "New" [ref=e4]\n- button "Search" [ref=e5]\n'
      + '- link "Home" [ref=e6]\n- link "Help" [ref=e7]\n- cell "Q1" [ref=e8]\n'
      + '- cell "Q2" [ref=e9]\n- paragraph "4 reports" [ref=e10]';
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/home', fromSnapshot: FROM,
      action: { role: 'link', name: 'Reports', ref: 'e2' },
      adapter: fake(AFTER_R, 'https://x.com/reports') as any,
    });
    const fx = rec.actionEffects('s')[0];
    expect(fx.navigated).toBe(true);
    expect(fx.requestedUrl).toBeUndefined();
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
