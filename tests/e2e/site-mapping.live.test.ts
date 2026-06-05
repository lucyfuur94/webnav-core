import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runSnapshotRecorded } from '../../src/router/browse.js';
import { analyseObservations } from '../../src/explorer/analyse.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: site mapping pipeline', () => {
  it('records two GitHub pages and analyses a multi-state structure', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('live-map');
    await runSnapshotRecorded('https://github.com/search?q=requests&type=repositories', 'live-map', rec);
    await runSnapshotRecorded('https://github.com/psf/requests', 'live-map', rec);
    rec.stop('live-map');
    const a = analyseObservations(rec.observations('live-map'));
    const gh = a.sites.find((s) => s.node === 'github.com');
    expect(gh).toBeDefined();
    expect(gh!.states.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
