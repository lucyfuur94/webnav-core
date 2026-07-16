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
