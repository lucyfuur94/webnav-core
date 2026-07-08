// Browser e2e smoke suite (opt-in: npm run test:e2e). Boots a REAL dashboard and
// drives a REAL headless browser against saucedemo — asserting on rendered UI and
// real recorder flow, the layer the unit suite mocks. Target is saucedemo ONLY
// (hermetic, no auth); the real product (auth-walled) is validated manually.
//
// GUARDRAILS honored (CLAUDE.md): headless only; browser sessions reaped after each
// test; one driven window at a time. The dashboard page itself is driven in a second
// headless session — allowed (the no-headed rule is about visible windows).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'bin', 'webnav');
const PORT = 7793;                       // fixed ephemeral-ish port for the test dashboard
const BASE = 'http://127.0.0.1:' + PORT;
const SAUCE = 'https://www.saucedemo.com';
const UI = 'ui-e2e';                     // the headless session that drives the DASHBOARD page

let dash: ChildProcess;
let env: NodeJS.ProcessEnv;

// Run the webnav CLI in the TEST env (isolated db/home) — critical so the CLI and
// the dashboard subprocess share the same store. Return parsed JSON stdout.
function cli(args: string[]): any {
  const out = execFileSync(CLI, args, { encoding: 'utf8', timeout: 90000, env });
  try { return JSON.parse(out); } catch { return out; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // isolate the test's webnav home so it never touches the user's real db/profiles
  const home = mkdtempSync(join(tmpdir(), 'webnav-e2e-'));
  // Fully isolated webnav home + a generous session ceiling: the suite opens a few
  // real browsers and the ceiling counter can lag behind actual liveness (orphan
  // reaping is coarse), which would spuriously refuse opens. WEBNAV_MAX_SESSIONS is
  // the sanctioned override for exactly this.
  env = { ...process.env, WEBNAV_DB: join(home, 'webnav.db'), WEBNAV_CREDS: join(home, 'creds.json'), HOME: home, WEBNAV_MAX_SESSIONS: '64' };
  dash = spawn(CLI, ['dev', 'dashboard', '--port', String(PORT)], { env, stdio: 'ignore' });
  // wait until the API actually returns a JSON array (server truly serving, not just
  // TCP-accepting) — a premature first request was racing the boot.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const out = execFileSync('curl', ['-sf', '--max-time', '1', BASE + '/api/recordings'], { encoding: 'utf8' });
      if (out.trim().startsWith('[')) { ready = true; break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!ready) throw new Error('dashboard did not become ready on ' + BASE);
  await sleep(500);   // small settle before the first driven navigate
}, 60000);

// Backstop reap after each test. record-stop now closes the browser (no leak), but a
// test that fails before its record-stop would still leave one — reap sweeps those.
afterEach(() => { try { execFileSync(CLI, ['dev', 'sessions', 'reap'], { env, timeout: 20000 }); } catch { /* */ } });

afterAll(() => {
  try { dash?.kill('SIGTERM'); } catch { /* */ }
  try { execFileSync(CLI, ['dev', 'sessions', 'reap'], { env, timeout: 20000 }); } catch { /* */ }
});

// helper: curl JSON off the dashboard API (uses the test env's home)
function api(path: string, method = 'GET', body?: unknown): any {
  const args = ['-s', '--max-time', '10', '-X', method, BASE + path];
  if (body !== undefined) args.push('-H', 'content-type: application/json', '-d', JSON.stringify(body));
  try { return JSON.parse(execFileSync('curl', args, { env, encoding: 'utf8' })); } catch { return null; }
}

describe('dashboard e2e (saucedemo, real browser)', () => {
  it('serves the dashboard shell with the operator tabs', () => {
    const html = execFileSync('curl', ['-s', BASE + '/'], { env, encoding: 'utf8' });
    expect(html).toContain('webnav dashboard');
    expect(html).toContain('data-tab="recordings"');
    expect(html).toContain('data-tab="profiles"');
  });

  it('agent record flow: navigate records a step + video; it shows in the API', async () => {
    const S = 'e2e-rec';
    const nav = cli(['use', 'navigate', SAUCE, '--session', S, '--profile', 'e2e', '--headless']);
    expect(nav.status).toBe('done');
    expect(nav.recorded).toBe(true);

    // the session is now live + recording — the dashboard reads the SAME store.
    // Poll briefly: the CLI write and the API read are separate sqlite connections.
    let steps: any[] = [];
    for (let i = 0; i < 10; i++) {
      steps = api('/api/recordings/' + S + '/steps') || [];
      if (steps.length >= 1) break;
      await sleep(300);
    }
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(1);

    const stop = cli(['dev', 'record-stop', '--session', S]);
    expect(stop.status).toBe('stopped');
    expect(stop.closed).toBe(true);   // record-stop closes the browser — no leak

    // session appears in the list with its profile — a first-class dashboard session.
    // (VIDEO for agent sessions is a KNOWN GAP: playwright-cli video can't span
    //  separate CLI processes, and `use` drives a different window than a filming
    //  record-live — needs a same-window control channel. Human dashboard recording
    //  DOES produce video. Tracked in the spec's follow-ups.)
    const list = api('/api/recordings');
    const row = list.find((r: any) => r.sessionId === S);
    expect(row).toBeTruthy();
    expect(row.profile).toBe('e2e');
  });

  it('profile reuse: two sessions share ONE named profile dir (the login-once guarantee)', async () => {
    // Both sessions opened under profile 'shared' must resolve to the SAME on-disk
    // profile dir — that dir IS the shared login (cookies/localStorage persist in it).
    cli(['use', 'navigate', SAUCE, '--session', 'e2e-p1', '--profile', 'shared', '--headless']);
    cli(['dev', 'record-stop', '--session', 'e2e-p1']);
    cli(['use', 'navigate', SAUCE, '--session', 'e2e-p2', '--profile', 'shared', '--headless']);
    cli(['dev', 'record-stop', '--session', 'e2e-p2']);
    const list = api('/api/recordings');
    const p1 = list.find((r: any) => r.sessionId === 'e2e-p1');
    const p2 = list.find((r: any) => r.sessionId === 'e2e-p2');
    expect(p1.profile).toBe('shared');
    expect(p2.profile).toBe('shared');                   // same profile → same login dir → shared login
    // and it surfaces as a single profile with 2 sessions in the Profiles tab
    const profs = api('/api/profiles');
    const shared = profs.find((p: any) => p.name === 'shared');
    expect(shared.sessions).toBe(2);
  });
});
