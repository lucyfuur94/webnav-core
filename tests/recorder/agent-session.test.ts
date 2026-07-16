import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runAgentSession, enrichName } from '../../src/recorder/agent-session.js';

// >=8 nodes with real content roles so classifyReadiness sees this as 'ready' (not
// 'loading') — otherwise the navigate handler's settle loop would retry 3x700ms real
// time on every test using this fixture.
const SNAP = 'RootWebArea "P" [ref=e1]\n  heading "Sign in" [ref=e0]\n  button "Login" [ref=e5]\n  textbox "User" [ref=e3]\n  link "Help" [ref=e6]\n  link "About" [ref=e7]\n  paragraph "Welcome back" [ref=e8]\n  button "Cancel" [ref=e9]';

// Fake adapter: records the calls made, returns canned snapshots/urls.
// navigateOnActRef: when act() is called with this ref, currentUrl flips to a
// new pathname afterward — simulates an in-page navigation from a click, so
// runActionRecorded's didNavigate(fromUrl,toUrl) comes back true.
function fakeAdapter(navigateOnActRef?: string) {
  const calls: string[] = [];
  let url = 'https://s.test/';
  return {
    calls,
    open: async (u: string) => { calls.push('open:' + u); },
    goto: async (u: string) => { calls.push('goto:' + u); url = u; },
    snapshot: async () => SNAP,
    currentUrl: async () => url,
    fill: async (r: string, t: string) => { calls.push('fill:' + r + '=' + t); },
    act: async (r: string) => { calls.push('act:' + r); if (r === navigateOnActRef) url = 'https://s.test/after-click'; },
    hover: async (r: string) => { calls.push('hover:' + r); },
    evalJs: async (js: string, ref?: string) => { calls.push('eval' + (ref ? ':' + ref : '')); return JSON.stringify('EVAL:' + js); },
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
    // video overlay: injected after navigate, carrying the installer + recording-on paint
    expect(ad.calls.some((c) => c === 'eval')).toBe(true);
  });

  it('injects the REC overlay (installer + recording-on paint) after navigate', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('a4');
    const ad = fakeAdapter();
    const evalArgs: string[] = [];
    const evalJs = ad.evalJs;
    ad.evalJs = async (js: string) => { evalArgs.push(js); return evalJs(js); };
    const io = driver(['{"cmd":"navigate","url":"https://s.test/next"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'a4', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null,
      startUrl: 'https://s.test/',
    });
    expect(evalArgs.length).toBe(1);
    expect(evalArgs[0]).toContain('__webnav_rec_badge');   // INSTALLER_JS overlay
    expect(evalArgs[0]).toContain("webnavRec = '1'");       // MODE_JS(true) recording-on paint
  });

  it('re-injects the REC overlay after a click that triggers in-page navigation', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('a5');
    const ad = fakeAdapter('e5');   // clicking e5 flips currentUrl → navigated:true
    const evalArgs: string[] = [];
    const evalJs = ad.evalJs;
    ad.evalJs = async (js: string) => { evalArgs.push(js); return evalJs(js); };
    const io = driver(['{"cmd":"click","ref":"e5"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'a5', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: 'Login', ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null,
      startUrl: 'https://s.test/',
    });
    // the click reported navigated:true...
    expect(io.out.some((o) => o.ok === true && o.navigated === true)).toBe(true);
    // ...so the overlay was re-injected (installer + recording-on paint) after it
    expect(evalArgs.length).toBe(1);
    expect(evalArgs[0]).toContain('__webnav_rec_badge');
    expect(evalArgs[0]).toContain("webnavRec = '1'");
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

  it('hover records a same-page effect marked action.hover, never navigates', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('h1');
    const ad = fakeAdapter();
    const io = driver(['{"cmd":"hover","ref":"e5"}', '{"cmd":"quit"}']);
    const res = await runAgentSession({
      sessionId: 'h1', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: 'Menu', ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'https://s.test/',
    });
    expect(ad.calls).toContain('hover:e5');
    const fx = store.actionEffects('h1');
    expect(fx.length).toBe(1);
    expect(fx[0].action?.hover).toBe(true);
    expect(fx[0].navigated).toBe(false);
    expect(res.steps).toBe(1);
  });

  it('navigate: settles (retries a loading snapshot) and records requestedUrl', async () => {
    // fake timers: the settle loop's real setTimeout(700ms) would otherwise make
    // this test slow; advancing fake time keeps the suite fast + deterministic.
    vi.useFakeTimers();
    try {
      const store = RecordStore.fromDatabase(new Database(':memory:'));
      store.start('nav-settle');
      const ad = fakeAdapter();
      // first snapshot after goto is a sparse loading shell; second is the real page
      const snaps = ['- generic "spinner"', '- heading "Reports"\n- button "New Report"\n- link "Dashboards"\n- link "Downloads"\n- link "Help"\n- link "Announcements"\n- button "Search"\n- button "Refresh"\n- button "Sort"'];
      let snapCall = 0;
      ad.snapshot = async () => snaps[Math.min(snapCall++, snaps.length - 1)];
      ad.currentUrl = async () => 'https://x.test/v3/1041/report/list';
      const io = driver(['{"cmd":"navigate","url":"https://x.test/v3/report/list"}', '{"cmd":"quit"}']);
      const done = runAgentSession({
        sessionId: 'nav-settle', adapter: ad as never, store: store as never,
        recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
        readLine: io.readLine, write: io.write, notify: () => {},
        startVideo: async () => {}, stopVideo: async () => null,
        startUrl: 'https://x.test/',
      });
      await vi.runAllTimersAsync();
      await done;
      const eff = store.actionEffects('nav-settle')[0];
      expect(eff.requestedUrl).toBe('https://x.test/v3/report/list');
      expect(eff.toUrl).toBe('https://x.test/v3/1041/report/list');
      expect(eff.toSnapshot).toContain('New Report');   // the SETTLED snapshot, not the spinner
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigate: a nameless landing is probed → effect carries nameHints; a named landing probes nothing', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('nh1');
    const ad = fakeAdapter();
    // landing of icon-only buttons (≥8 nodes so classifyReadiness = ready, no settle retry)
    const NAMELESS = 'RootWebArea "P" [ref=e1]\n  heading "Dash" [ref=e0]\n  button [ref=e5]\n  button [ref=e6]\n  link "Help" [ref=e7]\n  paragraph "Welcome" [ref=e8]\n  paragraph "More" [ref=e9]\n  paragraph "Even more" [ref=e10]';
    ad.snapshot = async () => NAMELESS;
    const probeRefs: string[] = [];
    ad.evalJs = async (js: string, ref?: string) => {
      if (ref) { probeRefs.push(ref); return JSON.stringify(ref === 'e5' ? 'Expand' : 'Favorite'); }
      return JSON.stringify('EVAL:' + js);   // ref-less = the overlay eval
    };
    const io = driver(['{"cmd":"navigate","url":"https://s.test/dash"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'nh1', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'https://s.test/',
    });
    expect(probeRefs.sort()).toEqual(['e5', 'e6']);   // only the two nameless buttons probed
    const fx = store.actionEffects('nh1')[0];
    expect(fx.nameHints).toEqual({ e5: 'Expand', e6: 'Favorite' });
  });

  it('a NAMELESS click probes the element attributes for a label (title/aria-label)', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('n1');
    const ad = fakeAdapter();
    // the name-probe eval (passed WITH a ref) returns a tooltip label for the icon
    ad.evalJs = async (js: string, ref?: string) => {
      if (ref === 'e9') return JSON.stringify('Duplicate');
      return JSON.stringify('EVAL:' + js);
    };
    const io = driver(['{"cmd":"click","ref":"e9"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'n1', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: null, ref } }),  // NO accessible name
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'https://s.test/',
    });
    const fx = store.actionEffects('n1');
    expect(fx.length).toBe(1);
    expect(fx[0].action?.name).toBe('Duplicate');   // probed label, not null / not the URL
  });
});

// The probe JS is executed in the browser (can't run here), but its LOGIC is the contract:
// a label-less sort header ('Name') whose text IS its label must resolve to that text, and
// a whole-row textContent must NOT be scraped (leaf-vs-container rule). We assert the JS
// SOURCE encodes the intended last-resort text fallback + its length/newline bound.
describe('NAME_PROBE_JS (source contract)', () => {
  it('reads data-tooltip-content (this app\'s tooltip attribute) and falls back to short own-text', async () => {
    const { NAME_PROBE_JS } = await import('../../src/recorder/agent-session.js');
    expect(NAME_PROBE_JS).toContain('data-tooltip-content');   // the progneo tooltip source
    expect(NAME_PROBE_JS).toContain('el.textContent');          // last-resort own-text (sort headers / date-range button)
    expect(NAME_PROBE_JS).toContain('length <= 120');           // bounded single-line — long labels OK, no multi-row scrape
  });
  it('never names webnav\'s own REC-overlay chrome, even if a page exposes it', async () => {
    const { NAME_PROBE_JS } = await import('../../src/recorder/agent-session.js');
    expect(NAME_PROBE_JS).toContain("el.closest('#__webnav_rec_badge')");
    // the guard must be the first statement — before any of the real probing logic runs.
    expect(NAME_PROBE_JS.indexOf("el.closest('#__webnav_rec_badge')")).toBeLessThan(NAME_PROBE_JS.indexOf('const ATTRS'));
  });
});

describe('agent ledger', () => {
  it('ledgers each action command with its fate; snapshot/eval add nothing; type stores no text', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('lg1');
    const ad = fakeAdapter();
    ad.currentUrl = async () => 'https://x.com/target';
    ad.goto = async (u: string) => { ad.calls.push('goto:' + u); (ad as any)._url = u; };
    const io = driver([
      '{"cmd":"navigate","url":"https://x.com/target"}',
      '{"cmd":"click","ref":"e1"}',
      '{"cmd":"type","ref":"e3","text":"hunter2"}',
      '{"cmd":"snapshot"}',
      '{"cmd":"quit"}',
    ]);
    await runAgentSession({
      sessionId: 'lg1', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'textbox', name: 'Field', ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null,
      startUrl: 'https://x.com/',
    });
    const ledger = store.events('lg1');
    expect(ledger.map((l) => l.kind)).toEqual(['navigate', 'click', 'type']);
    expect(ledger[0].source).toBe('agent');
    expect(ledger[0].descriptor.url).toBe('https://x.com/target');
    for (const l of ledger) expect(l.disposition).toMatch(/^step:\d+$/);
    expect(JSON.stringify(ledger[2].descriptor)).not.toContain('hunter2');
  });

  it('stamps dropped:failed when the action errors', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('lg2');
    const ad = fakeAdapter();
    ad.act = async () => { throw new Error('stale ref boom'); };
    const io = driver(['{"cmd":"click","ref":"e5"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'lg2', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: 'Login', ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null,
      startUrl: 'https://s.test/',
    });
    const ledger = store.events('lg2');
    const click = ledger.find((l) => l.kind === 'click');
    expect(click?.disposition).toMatch(/^dropped:failed:/);
  });

  it('hover ledgers with fate; navigate error drops the pending row', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('lg3');
    const ad = fakeAdapter();
    const io = driver(['{"cmd":"hover","ref":"e5"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'lg3', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: 'button', name: 'Menu', ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'https://s.test/',
    });
    const ledger = store.events('lg3');
    expect(ledger.map((l) => l.kind)).toEqual(['hover']);
    expect(ledger[0].disposition).toMatch(/^step:\d+$/);
    expect(ledger[0].descriptor).toMatchObject({ cmd: 'hover', ref: 'e5', role: 'button', name: 'Menu' });
  });

  it('navigate error stamps dropped:failed on the pending ledger row', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    store.start('lg4');
    const ad = fakeAdapter();
    ad.goto = async () => { throw new Error('nav exploded'); };
    const io = driver(['{"cmd":"navigate","url":"https://s.test/next"}', '{"cmd":"quit"}']);
    await runAgentSession({
      sessionId: 'lg4', adapter: ad as never, store: store as never,
      recover: (_s, ref) => ({ action: { role: '', name: null, ref } }),
      readLine: io.readLine, write: io.write, notify: () => {},
      startVideo: async () => {}, stopVideo: async () => null, startUrl: 'https://s.test/',
    });
    const ledger = store.events('lg4');
    expect(ledger.map((l) => l.kind)).toEqual(['navigate']);
    expect(ledger[0].disposition).toMatch(/^dropped:failed:/);
  });
});

describe('enrichName', () => {
  it('keeps the recovered accessible name when present', () => {
    expect(enrichName('Login', 'ignored')).toBe('Login');
  });
  it('falls back to the probed attribute label when name is empty', () => {
    expect(enrichName(null, 'Duplicate')).toBe('Duplicate');
    expect(enrichName('', '  Expand details ')).toBe('Expand details');
  });
  it('returns null when neither is available', () => {
    expect(enrichName(null, '')).toBe(null);
    expect(enrichName('  ', undefined)).toBe(null);
  });
  it('REJECTS a playwright error blob as a name (stale-ref eval returns "### Error …")', () => {
    expect(enrichName(null, '### Error\nError: Ref e1318 not found in the current page')).toBe(null);
    expect(enrichName('', 'Error: something broke')).toBe(null);
  });
});
