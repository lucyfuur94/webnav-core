import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function store(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}

const SNAP_A = '- button "Add to cart" [ref=e1]';
const SNAP_B = '- button "Remove" [ref=e1b]\n- generic "1" [ref=e2]';

describe('RecordStore action-effects', () => {
  it('appends and reads back a full action-effect (raw snapshots kept)', () => {
    const s = store();
    s.start('sess');
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/inventory.html', fromSnapshot: SNAP_A,
      action: { role: 'button', name: 'Add to cart', ref: 'e1' },
      toUrl: 'https://x.com/inventory.html', toSnapshot: SNAP_B,
      navigated: false, diff: { added: [{ role: 'button', name: 'Remove', ref: 'e1b', url: null, raw: '' }], removed: [] },
    });
    const fx = s.actionEffects('sess');
    expect(fx).toHaveLength(1);
    expect(fx[0].fromSnapshot).toBe(SNAP_A);
    expect(fx[0].toSnapshot).toBe(SNAP_B);
    expect(fx[0].navigated).toBe(false);
    expect(fx[0].action!.name).toBe('Add to cart');
    expect(fx[0].diff.added[0].name).toBe('Remove');
  });

  it('supports a null-action initial landing observation', () => {
    const s = store();
    s.start('sess');
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/', fromSnapshot: '',
      action: null, toUrl: 'https://x.com/inventory.html', toSnapshot: SNAP_A,
      navigated: true, diff: { added: [], removed: [] },
    });
    expect(s.actionEffects('sess')[0].action).toBeNull();
  });

  it('does not record when the session is inactive', () => {
    const s = store();
    s.start('sess'); s.stop('sess');
    s.appendActionEffect('sess', { fromUrl: 'u', fromSnapshot: '', action: null, toUrl: 'u', toSnapshot: '', navigated: false, diff: { added: [], removed: [] } });
    expect(s.actionEffects('sess')).toHaveLength(0);
  });
});
