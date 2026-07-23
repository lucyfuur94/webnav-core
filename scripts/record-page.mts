#!/usr/bin/env tsx
// Reusable page-record driver. ONE `use session` owns the browser + video for the whole run.
// Sequence (deterministic — waits for each JSON reply): navigate → settle → snapshot →
// run the REAL `dev hover-probe` verb against the SAME live session (it selectively records
// ONLY hovers that reveal new nodes — no noise) → quit. Video + all effects land in one session.
// Usage: tsx scripts/record-page.mts <session> <url> [--profile default] [--headless] [--limit N]
import { spawn, spawnSync } from 'node:child_process';

const [session, url] = process.argv.slice(2);
const profile = (() => { const i = process.argv.indexOf('--profile'); return i >= 0 ? process.argv[i + 1] : 'default'; })();
const limit = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? process.argv[i + 1] : '12'; })();
const headless = process.argv.includes('--headless');
if (!session || !url) { console.error('usage: record-page <session> <url> [--profile P] [--headless] [--limit N]'); process.exit(2); }

const args = ['use', 'session', '--session', session, '--url', 'about:blank', '--profile', profile];
if (headless) args.push('--headless');
const child = spawn('./bin/webnav', args, { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = ''; const waiters: ((o: any) => void)[] = [];
child.stdout.on('data', (d) => {
  buf += d.toString(); let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    try { const o = JSON.parse(line); const w = waiters.shift(); if (w) w(o); } catch { /* log */ }
  }
});
const send = (cmd: any): Promise<any> => new Promise((res) => { waiters.push(res); child.stdin.write(JSON.stringify(cmd) + '\n'); });
const ready = new Promise<any>((res) => waiters.push(res));

await ready;
const nav = await send({ cmd: 'navigate', url });
console.error(`navigate → ${nav.url} settled=${nav.settled}`);
await send({ cmd: 'snapshot' });

// REAL hover-probe verb against the SAME live session (selective — records only true reveals).
// Runs as a child process reattaching to the daemonized browser; we wait for it synchronously
// BEFORE quitting the session (so the session's video is still recording during the hovers).
console.error('running dev hover-probe…');
const hp = spawnSync('./bin/webnav', ['dev', 'hover-probe', '--session', session, '--limit', limit], { encoding: 'utf8' });
const hpAll = (hp.stdout || '') + (hp.stderr || '');
const m = hpAll.match(/\{[\s\S]*\}/);   // last complete JSON object (hover-probe pretty-prints)
try { const r = JSON.parse(m ? m[0] : '{}'); console.error(`hover-probe: ${r.status} probed=${r.probed} revealed=${r.revealed}`); }
catch { console.error('hover-probe raw:', hpAll.trim().slice(-200)); }

await send({ cmd: 'quit' });
await new Promise((res) => child.on('exit', res));
console.error('session closed');
