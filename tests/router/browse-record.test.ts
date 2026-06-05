import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runSnapshotRecorded } from '../../src/router/browse.js';

const FAKE_SNAPSHOT = `- heading "requests" [ref=e1]
- link "Issues" [ref=e2]
  /url: https://github.com/psf/requests/issues`;

function fakeAdapter() {
  return {
    open: async () => '',
    snapshot: async () => FAKE_SNAPSHOT,
    close: async () => '',
  };
}

describe('runSnapshotRecorded', () => {
  it('appends one observation (fingerprint + declared links) when recording is active', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s', 1);
    const r = await runSnapshotRecorded('https://github.com/psf/requests', 's', rec, fakeAdapter() as any);
    expect(r.status).toBe('done');
    expect(r.recorded).toBe(true);
    const obs = rec.observations('s');
    expect(obs).toHaveLength(1);
    expect(obs[0].fingerprint).toEqual(['heading', 'link']);
    expect(obs[0].declaredLinks[0].to).toBe('https://github.com/psf/requests/issues');
  });

  it('does not record when no session is active', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    const r = await runSnapshotRecorded('https://x.com', 's', rec, fakeAdapter() as any);
    expect(r.recorded).toBe(false);
    expect(rec.observations('s')).toHaveLength(0);
  });
});
