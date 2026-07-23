import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runSnapshotRecorded, recordNavigateEffect, classifyNavigateWall } from '../../src/router/browse.js';
import { makeState } from '../../src/mapstore/types.js';

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

// The standalone `use navigate` capture (cli.ts routes through this seam).
describe('recordNavigateEffect', () => {
  const READY = '- heading "Login" [ref=e1]\n- textbox "Username" [ref=e2]\n- textbox "Password" [ref=e3]\n'
    + '- button "Login" [ref=e4]\n- link "Forgot your password?" [ref=e5]\n- paragraph "OrangeHRM OS 5.7" [ref=e6]\n'
    + '- link "OrangeHRM, Inc" [ref=e7]\n- img "company-branding" [ref=e8]';

  it('settles a loading shell before capture and records requestedUrl = the asked-for url', async () => {
    vi.useFakeTimers();
    try {
      const rec = RecordStore.fromDatabase(new Database(':memory:'));
      rec.start('nav');
      const snaps = ['- generic "spinner"', READY];
      let call = 0;
      const adapter = {
        open: async () => '', close: async () => '',
        snapshot: async () => snaps[Math.min(call++, snaps.length - 1)],
        currentUrl: async () => 'https://x.test/web/index.php/auth/login',
      };
      const p = recordNavigateEffect('https://x.test/', 'nav', rec, adapter as any);
      await vi.runAllTimersAsync();
      const { toUrl } = await p;
      expect(toUrl).toBe('https://x.test/web/index.php/auth/login');
      const fx = rec.actionEffects('nav')[0];
      expect(fx.requestedUrl).toBe('https://x.test/');
      expect(fx.toUrl).toBe('https://x.test/web/index.php/auth/login');
      expect(fx.toSnapshot).toContain('Username');   // the SETTLED page, not the spinner
      expect(fx.navigated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probes a nameless landing → effect carries nameHints (observed labels)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('nh');
    // a landing of icon-only buttons: no accessible name, has a ref → probe target.
    const NAMELESS = '- button [ref=e5]\n- button [ref=e6]\n- heading "Dash" [ref=e1]';
    let evals = 0;
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => NAMELESS,
      currentUrl: async () => 'https://x.test/dash',
      evalJs: async (_js: string, ref?: string) => { evals++; return JSON.stringify(ref === 'e5' ? 'Expand' : 'Favorite'); },
    };
    await recordNavigateEffect('https://x.test/dash', 'nh', rec, adapter as any);
    expect(evals).toBe(2);   // one per nameless interactive node
    const fx = rec.actionEffects('nh')[0];
    expect(fx.nameHints).toEqual({ e5: 'Expand', e6: 'Favorite' });
  });

  it('threads settleSnapshot\'s DOM-quiet fast path: an evalJs adapter gets the page-global (ref-less) eval (T5)', async () => {
    // Production wiring regression net for F1's threading: recordNavigateEffect must pass its
    // adapter.evalJs into settleSnapshot so the DOM-quiet fast path actually fires on the CLI
    // navigate path. The DOM-quiet probe is the ONLY ref-less eval on a fully-named landing
    // (name-probe evals always carry a ref); assert exactly one ref-less eval was made.
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('fq');
    const evalCalls: { js: string; ref?: string }[] = [];
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => READY,   // fully named → no name-probe eval; stable → plateaus at once
      currentUrl: async () => 'https://x.test/web/index.php/auth/login',
      evalJs: async (js: string, ref?: string) => { evalCalls.push({ js, ref }); return JSON.stringify('quiet'); },
    };
    await recordNavigateEffect('https://x.test/', 'fq', rec, adapter as any);
    const refless = evalCalls.filter((c) => c.ref === undefined);
    expect(refless).toHaveLength(1);                       // exactly one DOM-quiet round-trip
    expect(refless[0].js).toContain('MutationObserver');   // it IS the DOM-quiet probe
  });

  it('an adapter WITHOUT evalJs makes NO eval and settles via the fallback only (T5)', async () => {
    // The other half of the wiring pin: a bare adapter (no evalJs) must never attempt an eval
    // — settleSnapshot's fallback plateau loop handles it. Guards against unconditional eval.
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('nq');
    let snapCalls = 0;
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => { snapCalls++; return READY; },   // stable → fallback plateaus
      currentUrl: async () => 'https://x.test/web/index.php/auth/login',
      // no evalJs property at all
    };
    const fx = (await (async () => {
      await recordNavigateEffect('https://x.test/', 'nq', rec, adapter as any);
      return rec.actionEffects('nq')[0];
    })());
    expect(fx.toSnapshot).toBe(READY);   // settled correctly with no eval available
    expect(snapCalls).toBeGreaterThanOrEqual(2);   // fallback took at least the plateau pair
  });

  it('a fully-named landing triggers ZERO name-probe evals and exactly one DOM-quiet eval (T6)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('nn');
    const probeEvals: string[] = [];      // name-probe calls (ALWAYS carry a ref)
    const domQuietEvals: string[] = [];   // settle's DOM-quiet probe (page-global, no ref)
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => READY,   // every interactive node has a name
      currentUrl: async () => 'https://x.test/web/index.php/auth/login',
      // Split the two eval kinds by presence of a ref so we can assert EXACT per-kind counts
      // (T6: restore strength) — zero name-probe evals AND exactly one DOM-quiet probe. A
      // duplicated-settle bug (two DOM-quiet evals) must fail this.
      evalJs: async (js: string, ref?: string) => {
        if (ref) probeEvals.push(js); else domQuietEvals.push(js);
        return JSON.stringify('quiet');
      },
    };
    await recordNavigateEffect('https://x.test/', 'nn', rec, adapter as any);
    expect(probeEvals).toHaveLength(0);
    expect(domQuietEvals).toHaveLength(1);
    expect(domQuietEvals[0]).toContain('MutationObserver');
    expect(rec.actionEffects('nn')[0].nameHints).toBeUndefined();
  });

  it('stamps settled:true on the effect AND returns it when the landing plateaus (T4)', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('st');
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => READY,   // stable, fully named → plateaus at once
      currentUrl: async () => 'https://x.test/web/index.php/auth/login',
    };
    const r = await recordNavigateEffect('https://x.test/', 'st', rec, adapter as any);
    expect(r.settled).toBe(true);
    expect(rec.actionEffects('st')[0].settled).toBe(true);
  });

  it('stamps settled:false on the effect AND returns it when the landing never plateaus (T4)', async () => {
    vi.useFakeTimers();
    try {
      const rec = RecordStore.fromDatabase(new Database(':memory:'));
      rec.start('sf');
      // Flappy: every read grows the node set by one (a page that keeps hydrating past
      // budget) → snapshotsPlateaued is always false → settle exhausts to settled:false.
      let n = 8;
      const adapter = {
        open: async () => '', close: async () => '',
        snapshot: async () => Array.from({ length: n++ }, (_, i) => `- button "b${i}" [ref=e${i}]`).join('\n'),
        currentUrl: async () => 'https://x.test/dash',
        // no evalJs → fallback plateau loop; never plateaus → budget-exhausts to false
      };
      const p = recordNavigateEffect('https://x.test/', 'sf', rec, adapter as any);
      await vi.runAllTimersAsync();
      const r = await p;
      expect(r.settled).toBe(false);
      expect(rec.actionEffects('sf')[0].settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ledgers the navigate before settling and stamps step:<seq> after', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('nav2');
    const adapter = {
      open: async () => '', close: async () => '',
      snapshot: async () => READY,
      currentUrl: async () => 'https://x.test/web/index.php/auth/login',
    };
    await recordNavigateEffect('https://x.test/', 'nav2', rec, adapter as any);
    const evs = rec.events('nav2');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ source: 'agent', kind: 'navigate' });
    expect(evs[0].descriptor).toMatchObject({ cmd: 'navigate', url: 'https://x.test/', fromUrl: 'https://x.test/' });
    expect(evs[0].disposition).toMatch(/^step:\d+$/);
  });
});

// `use navigate`'s authWall surfacing (design item 2, no-retry half): cli.ts feeds
// recordNavigateEffect's (toUrl, toSnapshot) through this pure classifier so the
// driving agent learns immediately instead of guessing from a bare snapshot.
describe('classifyNavigateWall', () => {
  it('flags authWall + loginUrl on a foreign-host SSO bounce', () => {
    const r = classifyNavigateWall(
      'https://intranet.example.com/', 'https://login.okta.com/sso/step-up', '- heading "Sign in"', []);
    expect(r).toEqual({ authWall: true, loginUrl: 'https://login.okta.com/sso/step-up' });
  });

  it('flags authWall on a login-shaped page on the right host', () => {
    const yml = '- textbox "Username" [ref=e1]\n- textbox "Password" [ref=e2]\n- button "Login" [ref=e3]';
    const r = classifyNavigateWall('https://intranet.example.com/', 'https://intranet.example.com/', yml, []);
    expect(r.authWall).toBe(true);
  });

  it('does not flag a normal landing that matches a known map state', () => {
    const states = [makeState({ id: 'intranet.example.com:home', nodeId: 'intranet.example.com',
      semanticName: 'home', urlPattern: '', role: 'detail', fingerprint: ['heading:Dashboard'] })];
    const yml = '- heading "Dashboard" [ref=e1]';
    const r = classifyNavigateWall('https://intranet.example.com/', 'https://intranet.example.com/', yml, states);
    expect(r).toEqual({ authWall: false });
  });

  it('an unparseable requested url honestly reports no wall (nothing to check)', () => {
    const r = classifyNavigateWall('not-a-url', 'not-a-url', '- heading "x"', []);
    expect(r).toEqual({ authWall: false });
  });
});
