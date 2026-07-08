// A Chrome profile dir can be opened by only ONE process. A prior webnav Chrome
// that didn't fully die leaves a SingletonLock (symlink "<host>-<pid>") and keeps
// the dir held → the next launch fails or hands off to the orphan ("Opening in
// existing browser session"). prepProfile reaps a LIVE webnav-owned holder and
// clears the (now stale) Singleton* files before a launch. Deps injected for tests.
import { readlinkSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export interface LockDeps {
  readlink: (p: string) => string;
  isWebnavChrome: (pid: number) => boolean;   // safe-to-kill gate (never the user's real Chrome)
  kill: (pid: number) => void;
  unlink: (p: string) => void;
}

/** Parse the holder pid from a SingletonLock symlink target ("<host>-<pid>"). */
export function lockHolderPid(target: string): number | null {
  const n = Number(target.split('-').pop());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Reap a live webnav-owned holder + clear stale Singleton* so a launch starts clean. */
export function prepProfileWith(dir: string, deps: LockDeps): void {
  try {
    const pid = lockHolderPid(deps.readlink(join(dir, 'SingletonLock')));
    if (pid && deps.isWebnavChrome(pid)) deps.kill(pid);
  } catch { /* no lock / not a symlink → nothing to reap */ }
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { deps.unlink(join(dir, f)); } catch { /* */ }
  }
}

/** Is pid a WEBNAV-launched Chrome (safe to kill), not the user's real one?
 *  Gate on the profiles path in argv — the user's real Chrome never has that. */
export function isWebnavChromePid(pid: number): boolean {
  try {
    const cmd = execSync('ps -p ' + pid + ' -o command=', { encoding: 'utf8' });
    return cmd.includes('.webnav/profiles') && /chrom/i.test(cmd);
  } catch { return false; }   // ps says gone → dead holder (stale lock)
}

/** Production wiring. */
export function prepProfile(dir: string): void {
  prepProfileWith(dir, {
    readlink: (p) => readlinkSync(p),
    isWebnavChrome: isWebnavChromePid,
    kill: (pid) => { try { process.kill(pid, 'SIGTERM'); } catch { /* */ } },
    unlink: (p) => rmSync(p, { force: true }),
  });
}
