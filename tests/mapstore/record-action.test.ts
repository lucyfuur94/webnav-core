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

  it('round-trips nameHints (present → equal; absent → undefined)', () => {
    const s = store();
    s.start('sess');
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/', fromSnapshot: '', action: null,
      toUrl: 'https://x.com/dash', toSnapshot: SNAP_A, navigated: true,
      diff: { added: [], removed: [] }, nameHints: { e5: 'Expand', e6: 'Favorite' },
    });
    s.appendActionEffect('sess', {
      fromUrl: 'https://x.com/dash', fromSnapshot: SNAP_A, action: null,
      toUrl: 'https://x.com/dash2', toSnapshot: SNAP_B, navigated: true,
      diff: { added: [], removed: [] },   // no nameHints
    });
    const fx = s.actionEffects('sess');
    expect(fx[0].nameHints).toEqual({ e5: 'Expand', e6: 'Favorite' });
    expect(fx[1].nameHints).toBeUndefined();
  });

  it('opens an old db with no name_hints column (migrate adds it, reads undefined)', () => {
    // Simulate a pre-X6 db: a bare table with the older columns, no name_hints.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE record_observations (session_id TEXT, seq INTEGER, url TEXT,
      fingerprint TEXT, declared_links TEXT, captured_at INTEGER, from_url TEXT,
      from_snapshot TEXT, action TEXT, to_url TEXT, to_snapshot TEXT, navigated INTEGER, diff TEXT);
      CREATE TABLE record_sessions (session_id TEXT PRIMARY KEY, active INTEGER, started_at INTEGER, stopped_at INTEGER);
      CREATE TABLE record_events (session_id TEXT, seq INTEGER, t INTEGER, source TEXT, kind TEXT, descriptor TEXT, disposition TEXT);`);
    const s = RecordStore.fromDatabase(db);   // migrate() must ADD name_hints, not throw
    s.start('old');
    s.appendActionEffect('old', {
      fromUrl: 'u', fromSnapshot: 'x', action: null, toUrl: 'u2', toSnapshot: SNAP_A,
      navigated: true, diff: { added: [], removed: [] },
    });
    expect(s.actionEffects('old')[0].nameHints).toBeUndefined();
  });
});
