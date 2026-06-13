import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// playwright-cli daemonizes each session (run-cli-server --daemon-session=…) so it
// survives the CLI process exiting — that's what lets `webnav use <verb> --session S`
// and `walk-resume` reattach across CLI calls. The cost: a session whose walk paused
// and was never resumed (or a `use` exploration that just stopped) leaks a Chrome +
// helpers forever, because nothing closes it. This module lists those sessions and
// reaps the dead/old ones. Pure core (inventory/plan) + a thin live wrapper.

export interface SessionInfo {
  name: string;
  live: boolean;      // a daemon process currently references this session
  ageMs: number;      // now - session-file mtime (Infinity if the file is gone but daemon is live)
  pid?: number;       // the daemon process id (live sessions only) — for reap force-close
}

export interface ReapOpts {
  all?: boolean;          // reap every session, live or not
  maxAgeMs?: number;      // also reap LIVE sessions older than this (a TTL sweep)
  exclude?: string;       // NEVER reap this session (the one the current command is using)
}

/** Session name out of a daemon command line (`…--daemon-session=/…/<name>.session`). */
export function sessionNameFromPs(line: string): string | null {
  const m = line.match(/--daemon-session=\S*?\/([^/]+)\.session\b/);
  return m ? m[1] : null;
}

/** Leading PID from a `ps -eo pid,command` line (or null if it has none). */
export function pidFromPs(line: string): number | null {
  const m = line.trim().match(/^(\d+)\s/);
  return m ? Number(m[1]) : null;
}

/**
 * Merge on-disk session files with the live daemon process list (`ps -eo pid,command`
 * lines) into one inventory. `live` = a daemon references the session (browser is up);
 * a file with no daemon is an ORPHAN; a live daemon with no file still surfaces. Live
 * sessions carry their daemon `pid` (for reap force-close). Pure — inputs injected.
 */
export function inventorySessions(
  files: { name: string; mtimeMs: number }[],
  psLines: string[],
  nowMs: number,
): SessionInfo[] {
  const livePid = new Map<string, number | undefined>();
  for (const line of psLines) {
    const name = sessionNameFromPs(line);
    if (name) livePid.set(name, pidFromPs(line) ?? undefined);
  }
  const byName = new Map<string, SessionInfo>();
  for (const f of files) {
    const live = livePid.has(f.name);
    byName.set(f.name, { name: f.name, live, ageMs: nowMs - f.mtimeMs, ...(live ? { pid: livePid.get(f.name) } : {}) });
  }
  for (const [name, pid] of livePid) {
    if (!byName.has(name)) byName.set(name, { name, live: true, ageMs: Infinity, pid });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Which sessions to close. Default: only orphans (dead browser). all → every session.
 *  maxAgeMs → also live sessions older than the TTL. exclude → never the current session. */
export function planReap(inv: SessionInfo[], opts: ReapOpts): SessionInfo[] {
  return inv.filter((s) => {
    if (opts.exclude !== undefined && s.name === opts.exclude) return false;  // never our own browser
    if (opts.all) return true;
    if (!s.live) return true;                              // orphan: always reap
    if (opts.maxAgeMs !== undefined && s.ageMs >= opts.maxAgeMs) return true;
    return false;
  });
}

// ─── live-session ceiling (prevents the browser-count explosion) ─────────────
export const DEFAULT_MAX_SESSIONS = 16;  // clears the sanctioned 11-agent fan-out with headroom

/** Resolve the ceiling from `WEBNAV_MAX_SESSIONS`; default 16; garbage/≤0 → default. */
export function ceilingFor(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_MAX_SESSIONS;
  const n = Number(envValue);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_SESSIONS;
}

/** May a NEW daemonized session open? Pure soft-cap inequality — no per-session judgment
 *  (#5a). `max <= 0` / NaN ⇒ unlimited. Best-effort: with no cross-process lock, concurrent
 *  openers can briefly overshoot by the number racing — acceptable. */
export function canOpen(liveCount: number, max: number): boolean {
  if (!Number.isFinite(max) || max <= 0) return true;
  return liveCount < max;
}

/** Translate `WEBNAV_SESSION_TTL_HOURS` into a reap plan, or null when the background
 *  sweep is OFF (var unset/blank/non-positive/non-numeric → no surprise reaping).
 *  `current` is the session the calling command is about to use — always protected. */
export function ttlSweepOpts(envValue: string | undefined, current: string): ReapOpts | null {
  if (!envValue) return null;
  const hours = Number(envValue);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return { maxAgeMs: hours * 3600_000, exclude: current };
}

// ─── live wrappers (not unit-tested; thin shells over fs/ps) ──────────────────
const DAEMON_DIR = join(homedir(), 'Library', 'Caches', 'ms-playwright', 'daemon');

function listSessionFiles(): { name: string; mtimeMs: number }[] {
  const out: { name: string; mtimeMs: number }[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(DAEMON_DIR); } catch { return out; }
  for (const d of dirs) {
    let entries: string[] = [];
    try { entries = readdirSync(join(DAEMON_DIR, d)); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith('.session')) continue;
      try {
        const mtimeMs = statSync(join(DAEMON_DIR, d, e)).mtimeMs;
        out.push({ name: e.replace(/\.session$/, ''), mtimeMs });
      } catch { /* file vanished mid-scan */ }
    }
  }
  return out;
}

async function listDaemonPs(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,command'], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\n').filter((l) => l.includes('--daemon-session='));
  } catch { return []; }
}

/** Live inventory of all playwright-cli sessions on this machine. */
export async function listSessions(nowMs: number): Promise<SessionInfo[]> {
  return inventorySessions(listSessionFiles(), await listDaemonPs(), nowMs);
}

/** Is a daemon pid still alive? (signal 0 = existence check, doesn't actually signal.) */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Close one session: graceful `playwright-cli close` first; if that leaves the daemon ALIVE
 * (wedged daemons ignore close — the case that needed a manual kill), force-kill the daemon
 * process group (negative pid → the whole tree, reaping its chrome children too). `pid` is
 * the daemon pid from the inventory; omit for orphans (graceful-only). Returns true if the
 * session is gone after.
 */
async function closeSession(name: string, pid?: number): Promise<boolean> {
  try { await execFileAsync('playwright-cli', [`-s=${name}`, 'close'], { maxBuffer: 1024 * 1024 }); }
  catch { /* graceful close failed; fall through to force-kill if we have a pid */ }
  if (pid === undefined) return true;                 // orphan / no daemon to kill
  if (!pidAlive(pid)) return true;                    // graceful close worked
  // Wedged: kill the daemon's process GROUP so its chrome children die too. Fall back to the
  // bare pid if the group kill isn't permitted.
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  return !pidAlive(pid);
}

/** Reap per `opts`; returns the names actually closed. */
export async function reapSessions(nowMs: number, opts: ReapOpts): Promise<string[]> {
  const targets = planReap(await listSessions(nowMs), opts);
  const closed: string[] = [];
  for (const t of targets) if (await closeSession(t.name, t.pid)) closed.push(t.name);
  return closed;
}

/**
 * Opt-in background sweep, fired by browser-opening verbs. OFF unless
 * `WEBNAV_SESSION_TTL_HOURS` is set (>0). Reaps orphans + sessions older than the TTL,
 * NEVER `currentSession` (the browser this command is about to drive). Fire-and-forget:
 * any error is swallowed so the actual command is never slowed or broken by housekeeping.
 * `await` is optional — callers can ignore the returned promise.
 */
export async function maybeTtlSweep(currentSession: string): Promise<void> {
  const opts = ttlSweepOpts(process.env.WEBNAV_SESSION_TTL_HOURS, currentSession);
  if (!opts) return;
  try { await reapSessions(Date.now(), opts); } catch { /* housekeeping must never break the command */ }
}

/**
 * Enforce the live-session ceiling before a DAEMONIZED verb (walk / use navigate / record)
 * opens a NEW browser. First frees what it safely can — orphans (dead-browser) AND
 * abandoned paused-walk browsers older than the stale-walk TTL (the real leak: a `needs-*`
 * pause leaves a LIVE daemon nothing else collects) — then checks `canOpen`. Returns
 * `{ ok:true }` to proceed, or `{ ok:false, reason }` to refuse with a clear message.
 * `staleWalkBrowsers` is the set of browser_session ids of paused walks older than the TTL
 * (supplied by the caller, which has the WalkSessionStore); never reaps `currentSession`.
 * Errors degrade to ok:true — the ceiling must never wedge a legitimate command shut on a
 * housekeeping failure.
 */
export async function ensureCanOpen(
  currentSession: string,
  staleWalkBrowsers: string[] = [],
): Promise<{ ok: boolean; reason?: string }> {
  const max = ceilingFor(process.env.WEBNAV_MAX_SESSIONS);
  try {
    const now = Date.now();
    let inv = await listSessions(now);
    // free orphans + abandoned stale paused-walk browsers (never the current one)
    const toFree = inv.filter((s) =>
      s.name !== currentSession && (!s.live || staleWalkBrowsers.includes(s.name)));
    for (const s of toFree) await closeSession(s.name, s.pid);
    if (toFree.length) inv = await listSessions(Date.now());
    const liveOthers = inv.filter((s) => s.live && s.name !== currentSession).length;
    if (!canOpen(liveOthers, max)) {
      return { ok: false, reason: `session ceiling reached (${liveOthers} live, max ${max}); close some with \`webnav dev sessions reap\` or raise WEBNAV_MAX_SESSIONS` };
    }
    return { ok: true };
  } catch {
    return { ok: true };  // never wedge a real command shut on a housekeeping error
  }
}
