import { describe, it, expect } from 'vitest';
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
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: BEFORE,
      action: { role: 'link', name: 'cart', ref: 'e9' },
      adapter: fake('- heading "Your Cart" [ref=e3]', 'https://x.com/cart.html') as any,
    });
    expect(rec.actionEffects('s')[0].navigated).toBe(true);
  });
});
