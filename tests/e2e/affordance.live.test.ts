import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { parseSnapshot, findByRoleAndName } from '../../src/playwright/snapshot.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: affordance recording (saucedemo add-to-cart)', () => {
  it('records add-to-cart as an in-page mutation (navigated=false, button flips)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('aff');
    const adapter = new PlaywrightAdapter('aff-' + Date.now());
    await adapter.open('https://www.saucedemo.com/');
    // log in
    const login = parseSnapshot(await adapter.snapshot());
    await adapter.fill(findByRoleAndName(login, 'textbox', 'Username')!.ref!, 'standard_user');
    await adapter.fill(findByRoleAndName(login, 'textbox', 'Password')!.ref!, 'secret_sauce');
    await adapter.click(findByRoleAndName(parseSnapshot(await adapter.snapshot()), 'button', 'Login')!.ref!);
    // on inventory: capture before, click first Add to cart via runActionRecorded
    const beforeSnap = await adapter.snapshot();
    const addBtn = parseSnapshot(beforeSnap).find((n) => n.role === 'button' && n.name === 'Add to cart' && n.ref);
    expect(addBtn).toBeTruthy();
    const fromUrl = await adapter.currentUrl();
    const r = await runActionRecorded({
      sessionId: 'aff', recordStore: rec,
      fromUrl, fromSnapshot: beforeSnap,
      action: { role: 'button', name: 'Add to cart', ref: addBtn!.ref! },
      adapter: adapter as any,
    });
    await adapter.close().catch(() => {});
    expect(r.recorded).toBe(true);
    expect(r.navigated).toBe(false);                       // THE point: in-page, not a new page
    const fx = rec.actionEffects('aff')[0];
    expect(fx.diff.added.some((n) => n.name === 'Remove')).toBe(true);  // button flipped
  }, 120_000);
});
