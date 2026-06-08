import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';

const BEFORE = '- textbox "Username" [ref=e1]';
const AFTER = '- textbox "Username" [ref=e1]\n- generic "standard_user" [ref=e2]';

function fake(after: string, toUrl: string) {
  const calls: string[] = [];
  return {
    adapter: {
      open: async () => '',
      snapshot: async () => after,
      close: async () => '',
      act: async () => { calls.push('act'); },
      fill: async (_ref: string, text: string) => { calls.push('fill:' + text); },
      currentUrl: async () => toUrl,
    },
    calls,
  };
}

describe('runActionRecorded — type (fill)', () => {
  it('fills text (not click) when the action carries text, and records the effect', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const f = fake(AFTER, 'https://x.com/login');
    const r = await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/login', fromSnapshot: BEFORE,
      action: { role: 'textbox', name: 'Username', ref: 'e1' },
      text: 'standard_user',
      adapter: f.adapter as any,
    });
    expect(r.recorded).toBe(true);
    expect(f.calls).toEqual(['fill:standard_user']);
    expect(rec.actionEffects('s')[0].navigated).toBe(false);
  });

  it('clicks (not fill) when no text is given', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const f = fake('- button "Login" [ref=e1]', 'https://x.com/login');
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/login', fromSnapshot: '- button "Login" [ref=e1]',
      action: { role: 'button', name: 'Login', ref: 'e1' },
      adapter: f.adapter as any,
    });
    expect(f.calls).toEqual(['act']);
  });
});
