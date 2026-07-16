import { describe, it, expect, vi } from 'vitest';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';

describe('PlaywrightAdapter', () => {
  it('builds session-scoped commands and counts calls', async () => {
    const calls: string[][] = [];
    const fakeRun = vi.fn(async (args: string[]) => { calls.push(args); return 'ok'; });
    const a = new PlaywrightAdapter('test-session', fakeRun);

    await a.goto('https://github.com');
    await a.click('e9');

    expect(calls[0]).toEqual(['-s=test-session', 'goto', 'https://github.com']);
    expect(calls[1]).toEqual(['-s=test-session', 'click', 'e9']);
    expect(a.callCount).toBe(2);
  });

  it('snapshot reads the YAML file path from stdout', async () => {
    const fakeRun = vi.fn(async () =>
      '### Page\n- Page URL: https://x\n### Snapshot\n- [Snapshot](.playwright-cli/page-1.yml)');
    const fakeReadFile = vi.fn((_p: string) => '- searchbox "Search" [ref=e8]');
    const a = new PlaywrightAdapter('s', fakeRun, fakeReadFile);
    const snap = await a.snapshot();
    expect(snap).toContain('searchbox');
    expect(fakeReadFile).toHaveBeenCalledWith('.playwright-cli/page-1.yml');
  });

  it('snapshot throws when stdout has no yml path', async () => {
    const a = new PlaywrightAdapter('s', async () => '### Page\n- Page URL: https://x');
    await expect(a.snapshot()).rejects.toThrow(/could not find YAML path/);
  });

  it('snapshotReady RETRIES a loading SPA until it renders (the read/OrangeHRM fix)', async () => {
    // first two snapshots are an unrendered shell (loading), third has the real form (ready)
    const SHELL = '- generic [ref=e1]';   // < minNodes, no content → 'loading'
    const FORM = ['- heading "Login" [ref=e10]', '- textbox "Username" [ref=e23]',
      '- textbox "Password" [ref=e30]', '- button "Login" [ref=e32]',
      '- paragraph "Forgot?" [ref=e34]', '- link "Help" [ref=e35]',
      '- img "logo" [ref=e60]', '- heading "OrangeHRM" [ref=e61]'].join('\n');
    let n = 0;
    const fakeRun = vi.fn(async () => '### Snapshot\n- [Snapshot](.x.yml)');
    const fakeRead = vi.fn(() => (++n <= 2 ? SHELL : FORM));
    const a = new PlaywrightAdapter('s', fakeRun, fakeRead);
    const snap = await a.snapshotReady(6, 0);   // gap 0 — no real wait in the test
    expect(snap).toContain('button "Login"');   // got the RENDERED page, not the shell
    expect(n).toBe(3);                            // retried twice, then ready
  });

  it('snapshotReady returns the last snapshot when the budget is exhausted (caller still classifies)', async () => {
    const SHELL = '- generic [ref=e1]';
    const a = new PlaywrightAdapter('s', async () => '### Snapshot\n- [Snapshot](.x.yml)', () => SHELL);
    const snap = await a.snapshotReady(3, 0);
    expect(snap).toBe(SHELL);   // never rendered → returns last; read.ts then reports blocked
  });

  it('rightClick sends click <ref> right', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; });
    await a.rightClick('e1');
    expect(calls[0]).toEqual(['-s=s', 'click', 'e1', 'right']);
  });

  it('fill passes ref then text in order', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; });
    await a.fill('e8', 'playwright');
    expect(calls[0]).toEqual(['-s=s', 'fill', 'e8', 'playwright']);
  });

  it('open is HEADED by default — carries --headed', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; });
    await a.open('https://x');
    expect(calls[0]).toEqual(['-s=s', 'open', 'https://x', '--headed']);
  });

  it('open with {headed:false} is headless — no browser flags', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; },
      undefined, { headed: false });
    await a.open('https://x');
    expect(calls[0]).toEqual(['-s=s', 'open', 'https://x']);
  });

  it('open forwards BrowserOpts (headed/persistent/profile/browser) as flags', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; },
      undefined, { headed: true, persistent: true, profile: '/tmp/p', browser: 'firefox' });
    await a.open('https://x');
    expect(calls[0]).toEqual(['-s=s', 'open', 'https://x', '--headed', '--persistent', '--profile', '/tmp/p', '--browser', 'firefox']);
  });

  it('configPath emits --config ONLY when headed (headless keeps a fixed viewport)', async () => {
    const headedCalls: string[][] = [];
    const h = new PlaywrightAdapter('s', async (args) => { headedCalls.push(args); return 'ok'; },
      undefined, { headed: true, configPath: '/tmp/pw.json' });
    await h.open('https://x');
    expect(headedCalls[0]).toContain('--config');
    expect(headedCalls[0]).toContain('/tmp/pw.json');

    const headlessCalls: string[][] = [];
    const l = new PlaywrightAdapter('s', async (args) => { headlessCalls.push(args); return 'ok'; },
      undefined, { headed: false, configPath: '/tmp/pw.json' });
    await l.open('https://x');
    expect(headlessCalls[0]).not.toContain('--config');   // headless: config skipped
  });

  it('browser flags apply ONLY to open, not to subsequent commands', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; },
      undefined, { headed: true });
    await a.open('https://x');
    await a.click('e1');
    expect(calls[0]).toContain('--headed');
    expect(calls[1]).toEqual(['-s=s', 'click', 'e1']);   // no --headed on click
  });
});

import { resolveProfile } from '../../src/playwright/adapter.js';
describe('resolveProfile', () => {
  it('bare session name → profiles root; explicit path passes through; name sanitized', () => {
    expect(resolveProfile('my-app', '/home/u/.webnav/profiles')).toBe('/home/u/.webnav/profiles/my-app');
    expect(resolveProfile('/abs/dir', '/home/u/.webnav/profiles')).toBe('/abs/dir');
    expect(resolveProfile('a b/../x', '/home/u/.webnav/profiles')).toBe('a b/../x');       // has slash → path, as-is
    expect(resolveProfile('a b*x', '/root/p')).toBe('/root/p/a_b_x');                       // sanitized
  });
});

import { wireSessionName } from '../../src/playwright/adapter.js';

describe('wireSessionName (macOS unix-socket 104-char cap)', () => {
  it('leaves short names untouched', () => {
    expect(wireSessionName('walk-1')).toBe('walk-1');
    expect(wireSessionName('a'.repeat(16))).toBe('a'.repeat(16));
  });
  it('caps long names to exactly 16 chars, deterministically', () => {
    const long = 'replay-report-builder';   // 21 chars — the live crash name
    const capped = wireSessionName(long);
    expect(capped).toHaveLength(16);
    expect(capped.startsWith('replay-re')).toBe(true);   // readable head survives
    expect(wireSessionName(long)).toBe(capped);           // same input → same wire name
    expect(wireSessionName(long + 'x')).not.toBe(capped); // distinct inputs stay distinct
    expect(capped).toMatch(/^[\w.-]+$/);                  // stays a valid session name
  });
  it('adapter puts the capped name on the wire', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('replay-report-builder', async (args) => { calls.push(args); return 'ok'; });
    await a.click('e1');
    expect(calls[0][0]).toBe('-s=' + wireSessionName('replay-report-builder'));
  });
  it('sanitizes non-wire characters in the head slice before capping', () => {
    const capped = wireSessionName('weird name that is long!!');
    expect(capped).toHaveLength(16);
    expect(capped).toMatch(/^[\w.-]+$/);
    expect(wireSessionName('weird name that is long!!')).toBe(capped);   // deterministic
  });
});
