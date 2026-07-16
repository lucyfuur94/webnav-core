import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function store(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}
const FX = { fromUrl: 'u', fromSnapshot: 's', action: null, toUrl: 'u2', toSnapshot: 's2',
  navigated: true, diff: { added: [], removed: [] } };

describe('RecordStore ledger (record_events)', () => {
  it('appends, stamps, and reads back events in order', () => {
    const s = store();
    s.start('sess');
    const a = s.appendEvent('sess', { t: 111, source: 'human', kind: 'click', descriptor: { leafText: 'Login' } });
    const b = s.appendEvent('sess', { source: 'agent', kind: 'navigate', descriptor: { url: 'https://x.com' } });
    expect(a).toBe(0);
    expect(b).toBe(1);
    s.stampEvent('sess', a!, 'step:0');
    s.stampEvent('sess', b!, 'dropped:failed:timeout');
    const evs = s.events('sess');
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ seq: 0, t: 111, source: 'human', kind: 'click', disposition: 'step:0' });
    expect(evs[0].descriptor).toEqual({ leafText: 'Login' });
    expect(evs[1].disposition).toBe('dropped:failed:timeout');
  });
  it('stamps a default t (nowMs) when the event carries none; an explicit t always wins', () => {
    const s = store();
    s.start('sess');
    const noT = s.appendEvent('sess', { source: 'agent', kind: 'navigate', descriptor: {} }, 12345);
    const withT = s.appendEvent('sess', { t: 111, source: 'human', kind: 'click', descriptor: {} }, 12345);
    const evs = s.events('sess');
    expect(evs[noT!].t).toBe(12345);
    expect(evs[withT!].t).toBe(111);
  });
  it('appendEvent is a no-op returning null when the session is inactive', () => {
    const s = store();
    s.start('sess'); s.stop('sess');
    expect(s.appendEvent('sess', { source: 'human', kind: 'click', descriptor: {} })).toBeNull();
    expect(s.events('sess')).toHaveLength(0);
  });
  it('appendActionEffect returns the step seq (and null when inactive)', () => {
    const s = store();
    s.start('sess');
    expect(s.appendActionEffect('sess', FX)).toBe(0);
    expect(s.appendActionEffect('sess', FX)).toBe(1);
    s.stop('sess');
    expect(s.appendActionEffect('sess', FX)).toBeNull();
  });
  it('delete/clear/rename cover record_events', () => {
    const s = store();
    s.start('a');
    s.appendEvent('a', { source: 'human', kind: 'click', descriptor: {} });
    expect(s.renameSession('a', 'b')).toBe(true);
    expect(s.events('b')).toHaveLength(1);
    expect(s.events('a')).toHaveLength(0);
    s.deleteSession('b');
    expect(s.events('b')).toHaveLength(0);
  });
});
