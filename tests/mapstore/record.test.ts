import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function freshStore(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}

describe('RecordStore', () => {
  it('starts a session, appends observations, reads them back in order', () => {
    const store = freshStore();
    const id = store.start('sess-1', 1000);
    expect(id).toBe('sess-1');
    store.append('sess-1', { url: 'https://github.com/a', fingerprint: ['searchbox'], declaredLinks: [{ to: 'https://github.com/b', via: 'follow link "B"' }] }, 1001);
    store.append('sess-1', { url: 'https://github.com/b', fingerprint: ['heading'], declaredLinks: [] }, 1002);
    const obs = store.observations('sess-1');
    expect(obs).toHaveLength(2);
    expect(obs[0].url).toBe('https://github.com/a');
    expect(obs[0].seq).toBe(0);
    expect(obs[1].seq).toBe(1);
    expect(obs[0].declaredLinks[0].via).toBe('follow link "B"');
  });

  it('stop() marks the session inactive and isActive reflects it', () => {
    const store = freshStore();
    store.start('s', 1);
    expect(store.isActive('s')).toBe(true);
    store.stop('s', 2);
    expect(store.isActive('s')).toBe(false);
  });

  it('append to an inactive session is a no-op (recording is off)', () => {
    const store = freshStore();
    store.start('s', 1);
    store.stop('s', 2);
    store.append('s', { url: 'u', fingerprint: [], declaredLinks: [] }, 3);
    expect(store.observations('s')).toHaveLength(0);
  });

  it('isActive is false for an unknown session', () => {
    expect(freshStore().isActive('nope')).toBe(false);
  });
});
