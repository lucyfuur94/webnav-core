import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const live = process.env.WEBNAV_LIVE === '1';

const DBDIR = mkdtempSync(join(tmpdir(), 'webnav-itest-'));
async function cli(args: string[]) {
  const { stdout } = await exec('npx', ['tsx', 'src/cli.ts', ...args],
    { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, WEBNAV_DB: join(DBDIR, 'webnav.db') } });
  return stdout;
}
function json(s: string) { return JSON.parse(s); }
function refOf(snapshot: string, re: RegExp): string | null {
  for (const line of snapshot.split('\n')) if (re.test(line)) { const m = line.match(/\[ref=(e\d+)\]/); if (m) return m[1]; }
  return null;
}
afterAll(() => rmSync(DBDIR, { recursive: true, force: true }));

describe.skipIf(!live)('live: interactive CLI on saucedemo', () => {
  it('drives login + add-to-cart and records the effects', async () => {
    await cli(['dev', 'record-start', '--session', 'it1']);
    json(await cli(['navigate', 'https://www.saucedemo.com', '--session', 'it1']));
    const login = json(await cli(['snapshot', '--session', 'it1'])).snapshot;
    const userRef = refOf(login, /textbox "Username"/)!;
    const passRef = refOf(login, /textbox "Password"/)!;
    const loginRef = refOf(login, /button "Login"/)!;
    expect(userRef && passRef && loginRef).toBeTruthy();
    await cli(['type', userRef, 'standard_user', '--session', 'it1']);
    await cli(['type', passRef, 'secret_sauce', '--session', 'it1']);
    const r = json(await cli(['click', loginRef, '--session', 'it1']));
    expect(r.navigated).toBe(true);                              // login navigates to inventory
    const inv = json(await cli(['snapshot', '--session', 'it1'])).snapshot;
    const addRef = refOf(inv, /button "Add to cart"/)!;
    expect(addRef).toBeTruthy();
    const add = json(await cli(['click', addRef, '--session', 'it1']));
    expect(add.navigated).toBe(false);                           // add-to-cart is in-page
    await cli(['dev', 'record-stop', '--session', 'it1']);
    const analysis = json(await cli(['dev', 'graph-analyse', '--session', 'it1']));
    expect(analysis.sites.some((s: any) => s.node === 'www.saucedemo.com')).toBe(true);
  }, 180_000);
});
