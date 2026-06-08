import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { diffSnapshots } from '../../src/explorer/diff.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { analyseActionEffects } from '../../src/explorer/analyse.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: site mapping pipeline', () => {
  it('records a GitHub action-effect and presents it structure-neutrally', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('live-map');
    const adapter = new PlaywrightAdapter('live-map');
    try {
      await adapter.open('https://github.com/search?q=requests&type=repositories');
      const fromSnapshot = await adapter.snapshot();
      const fromUrl = await adapter.currentUrl();
      await adapter.open('https://github.com/psf/requests');
      const toSnapshot = await adapter.snapshot();
      const toUrl = await adapter.currentUrl();
      rec.appendActionEffect('live-map', {
        fromUrl, fromSnapshot, action: null, toUrl, toSnapshot, navigated: true,
        diff: diffSnapshots(parseSnapshot(fromSnapshot), parseSnapshot(toSnapshot)),
      });
    } finally {
      await adapter.close().catch(() => {});
    }
    rec.stop('live-map');
    const a = analyseActionEffects(rec.actionEffects('live-map'));
    const gh = a.sites.find((s) => s.node === 'github.com');
    expect(gh).toBeDefined();
    expect(gh!.observations.length).toBeGreaterThanOrEqual(1);
    // structure-neutral: no clustering/states imposed
    expect(gh).not.toHaveProperty('states');
  }, 60_000);
});
