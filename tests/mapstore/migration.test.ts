import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';

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
});
