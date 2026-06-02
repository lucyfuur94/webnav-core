import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';

// Build a legacy `states` table WITHOUT node_id, insert a row, then open via
// MapStore and assert the column was added + backfilled from the id prefix.
function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE states (id TEXT PRIMARY KEY, semantic_name TEXT NOT NULL,
    url_pattern TEXT NOT NULL, role TEXT NOT NULL, available_signals TEXT NOT NULL,
    fingerprint TEXT NOT NULL);`);
  db.prepare(`INSERT INTO states VALUES (?,?,?,?,?,?)`).run(
    'github:repo-detail', 'github:repo-detail', 'https://github.com/*/*', 'detail', '[]', '[]');
  return db;
}

describe('node_id migration', () => {
  it('adds node_id and backfills from the id prefix', () => {
    const db = legacyDb();
    const store = MapStore.fromDatabase(db); // open over an existing handle
    expect(store.getState('github:repo-detail')?.nodeId).toBe('github.com');
  });

  it('is idempotent — running open twice does not throw', () => {
    const db = legacyDb();
    MapStore.fromDatabase(db);
    expect(() => MapStore.fromDatabase(db)).not.toThrow();
  });

  it('leaves node_id NULL for an unknown prefix', () => {
    const db = legacyDb();
    db.prepare(`INSERT INTO states VALUES (?,?,?,?,?,?)`).run(
      'weird:thing', 'weird:thing', 'x', 'detail', '[]', '[]');
    const store = MapStore.fromDatabase(db);
    expect(store.getState('weird:thing')?.nodeId == null).toBe(true);
  });

  it('upsertState writes correctly on a MIGRATED db (node_id is the LAST column there)', () => {
    // After ALTER TABLE ADD COLUMN, node_id is appended last — not 2nd as in
    // fresh schema. A positional INSERT would shift every field by one. Write a
    // state to a migrated store and confirm every field round-trips intact.
    const db = legacyDb();
    const store = MapStore.fromDatabase(db);
    store.upsertState(makeState({ id: 'github:result-list', nodeId: 'github.com',
      semanticName: 'github:result-list', urlPattern: 'https://github.com/search*',
      role: 'result-list', availableSignals: ['x'], fingerprint: ['link'] }));
    const got = store.getState('github:result-list');
    expect(got?.nodeId).toBe('github.com');
    expect(got?.semanticName).toBe('github:result-list');
    expect(got?.urlPattern).toBe('https://github.com/search*');
    expect(got?.role).toBe('result-list');
    expect(got?.availableSignals).toEqual(['x']);
    expect(got?.fingerprint).toEqual(['link']);
  });
});
