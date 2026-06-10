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

  it('fill passes ref then text in order', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; });
    await a.fill('e8', 'playwright');
    expect(calls[0]).toEqual(['-s=s', 'fill', 'e8', 'playwright']);
  });

  it('open is HEADLESS by default — no browser flags', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('s', async (args) => { calls.push(args); return 'ok'; });
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
