import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runAgentSession } from '../../src/recorder/agent-session.js';

const SNAP = 'RootWebArea "P" [ref=e1]\n  button "Login" [ref=e5]\n  textbox "User" [ref=e3]';

// Fake adapter: records the calls made, returns canned snapshots/urls.
function fakeAdapter() {
  const calls: string[] = [];
  let url = 'https://s.test/';
  return {
    calls,
    open: async (u: string) => { calls.push('open:' + u); },
    goto: async (u: string) => { calls.push('goto:' + u); url = u; },
    snapshot: async () => SNAP,
    currentUrl: async () => url,
    fill: async (r: string, t: string) => { calls.push('fill:' + r + '=' + t); },
    act: async (r: string) => { calls.push('act:' + r); },
    evalJs: async (js: string) => { calls.push('eval'); return JSON.stringify('EVAL:' + js); },
    close: async () => { calls.push('close'); },
  };
}

function driver(cmds: string[]) {
  let i = 0;
  const out: any[] = [];
  return {
    readLine: async () => (i < cmds.length ? cmds[i++] : null),
    write: (l: string) => out.push(JSON.parse(l)),
    out,
  };
}

describe('runAgentSession', () => {
  it('dispatches navigate/snapshot/click/type, records steps, tears down with video before close', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('a1');
    const ad = fakeAdapter();
    const io = driver([
      '{"cmd":"snapshot"}',
      '{"cmd":"navigate","url":"https://s.test/next"}',
      '{"cmd":"click","ref":"e5"}',
      '{"cmd":"type","ref":"e3","text":"bob"}',
      '{"cmd":"quit"}',
    ]);
    const events: string[] = [];
    let videoStopped = false; const order: string[] = [];
    const res = await runAgentSession({
      sessionId: 'a1', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: 'Login', ref } }),
      readLine: io.readLine, write: io.write,
      notify: (k) => events.push(k),
      startVideo: async () => { order.push('startVideo'); },
      stopVideo: async () => { order.push('stopVideo'); videoStopped = true; return '/v/take.webm'; },
      startUrl: 'https://s.test/',
    });
    // video stop happened, and BEFORE close (order matters — else nothing saves)
    expect(res.video).toBe('/v/take.webm');
    expect(order).toEqual(['startVideo', 'stopVideo']);
    expect(ad.calls[ad.calls.length - 1]).toBe('close');   // close is last
    expect(videoStopped).toBe(true);
    // steps recorded: navigate + click + type = 3 (snapshot doesn't record)
    expect(store.actionEffects('a1').length).toBe(3);
    expect(res.steps).toBe(3);
    // snapshot returned to the agent
    expect(io.out.some((o) => o.snapshot === SNAP)).toBe(true);
    // realtime step events fired
    expect(events.filter((e) => e === 'step').length).toBe(3);
  });

  it('EOF (stdin closed) tears down cleanly, same as quit', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('a2');
    const ad = fakeAdapter();
    const io = driver([]);   // immediate EOF
    const res = await runAgentSession({
      sessionId: 'a2', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'x',
    });
    expect(res.steps).toBe(0);
    expect(ad.calls).toContain('close');   // closed even on EOF (no leak)
  });

  it('bad JSON / unknown cmd → error result, session continues', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('a3');
    const ad = fakeAdapter();
    const io = driver(['not json', '{"cmd":"bogus"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'a3', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'x',
    });
    const errs = io.out.filter((o) => o.ok === false);
    expect(errs.length).toBe(2);   // bad json + unknown cmd, both handled, no crash
    expect(ad.calls).toContain('close');
  });
});
