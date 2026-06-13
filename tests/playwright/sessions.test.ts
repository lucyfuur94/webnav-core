import { describe, it, expect } from 'vitest';
import { inventorySessions, planReap, ttlSweepOpts, canOpen, ceilingFor, pidFromPs, sessionNameFromPs } from '../../src/playwright/sessions.js';

// A fake `ps` listing: each line is the daemon command with its --daemon-session path.
// `ps -eo pid,command` style: leading PID, then the command (the daemon-session path).
const psLines = [
  ' 4101 run-cli-server --daemon-session=/cache/daemon/abc/walk-1.session',
  ' 4102 run-cli-server --daemon-session=/cache/daemon/abc/bench-a2.session',
];
// Session files on disk (name + mtime ms): walk-1 + bench-a2 are live; old-1 is orphaned
// (file exists, no live daemon); login is live but recent.
const files = [
  { name: 'walk-1', mtimeMs: 1_000 },
  { name: 'bench-a2', mtimeMs: 2_000 },
  { name: 'old-1', mtimeMs: 500 },     // orphaned (not in psLines)
];

describe('inventorySessions', () => {
  it('marks a session live iff a daemon process references it', () => {
    const inv = inventorySessions(files, psLines, 10_000);
    const byName = Object.fromEntries(inv.map((s) => [s.name, s]));
    expect(byName['walk-1'].live).toBe(true);
    expect(byName['bench-a2'].live).toBe(true);
    expect(byName['old-1'].live).toBe(false);   // file present, no daemon -> orphaned
  });

  it('reports age from mtime against now', () => {
    const inv = inventorySessions(files, psLines, 10_000);
    expect(inv.find((s) => s.name === 'walk-1')!.ageMs).toBe(9_000);
  });

  it('includes a live daemon even if its session file was already deleted', () => {
    const inv = inventorySessions([], psLines, 10_000);
    // both live sessions surface with live:true despite no file row
    expect(inv.filter((s) => s.live).map((s) => s.name).sort()).toEqual(['bench-a2', 'walk-1']);
  });

  it('captures the daemon PID for live sessions (for reap force-close)', () => {
    const inv = inventorySessions(files, psLines, 10_000);
    const byName = Object.fromEntries(inv.map((s) => [s.name, s]));
    expect(byName['walk-1'].pid).toBe(4101);
    expect(byName['bench-a2'].pid).toBe(4102);
    expect(byName['old-1'].pid).toBeUndefined();   // orphan: no live daemon → no pid
  });
});

describe('planReap', () => {
  const inv = [
    { name: 'walk-1', live: true, ageMs: 1_000 },
    { name: 'old-1', live: false, ageMs: 9_000 },
    { name: 'stale-live', live: true, ageMs: 5 * 60 * 60 * 1000 }, // 5h old, still live
  ];
  it('default reaps ONLY orphaned (dead-browser) sessions', () => {
    expect(planReap(inv, {}).map((s) => s.name)).toEqual(['old-1']);
  });
  it('with maxAgeMs also reaps live sessions older than the TTL', () => {
    const got = planReap(inv, { maxAgeMs: 4 * 60 * 60 * 1000 }).map((s) => s.name).sort();
    expect(got).toEqual(['old-1', 'stale-live']);
  });
  it('with all=true reaps every session', () => {
    expect(planReap(inv, { all: true }).map((s) => s.name).sort())
      .toEqual(['old-1', 'stale-live', 'walk-1']);
  });
  it('NEVER reaps the protected session (the one the current command is using)', () => {
    // even with all=true + a TTL, exclude is honored — the live command must not kill its own browser
    expect(planReap(inv, { all: true, exclude: 'walk-1' }).map((s) => s.name).sort())
      .toEqual(['old-1', 'stale-live']);
    expect(planReap(inv, { maxAgeMs: 4 * 60 * 60 * 1000, exclude: 'stale-live' }).map((s) => s.name))
      .toEqual(['old-1']);
  });
});

describe('pidFromPs / sessionNameFromPs (ps -eo pid,command parsing)', () => {
  const line = ' 4101 run-cli-server --daemon-session=/cache/daemon/abc/walk-1.session';
  it('extracts the leading pid', () => {
    expect(pidFromPs(line)).toBe(4101);
    expect(pidFromPs('run-cli-server --daemon-session=/x/y.session')).toBeNull();  // no pid column
  });
  it('still extracts the session name with the pid column present', () => {
    expect(sessionNameFromPs(line)).toBe('walk-1');
  });
});

describe('canOpen (live-session ceiling — soft cap, pure inequality)', () => {
  it('allows opening below the cap, refuses at/above it', () => {
    expect(canOpen(0, 16)).toBe(true);
    expect(canOpen(15, 16)).toBe(true);
    expect(canOpen(16, 16)).toBe(false);   // at cap → refuse (no per-session judgment)
    expect(canOpen(20, 16)).toBe(false);
  });
  it('treats a non-positive/invalid cap as unlimited (never refuse)', () => {
    expect(canOpen(100, 0)).toBe(true);
    expect(canOpen(100, NaN)).toBe(true);
  });
});

describe('ceilingFor (env → resolved cap)', () => {
  it('defaults to 16 when unset', () => {
    expect(ceilingFor(undefined)).toBe(16);
    expect(ceilingFor('')).toBe(16);
  });
  it('honors a valid override', () => {
    expect(ceilingFor('24')).toBe(24);
  });
  it('falls back to the default on garbage', () => {
    expect(ceilingFor('abc')).toBe(16);
    expect(ceilingFor('-3')).toBe(16);
  });
});

describe('ttlSweepOpts (env → reap opts)', () => {
  it('returns null when the env var is unset/blank (off by default)', () => {
    expect(ttlSweepOpts(undefined, 'sess-x')).toBeNull();
    expect(ttlSweepOpts('', 'sess-x')).toBeNull();
  });
  it('parses hours → maxAgeMs and protects the current session', () => {
    expect(ttlSweepOpts('6', 'sess-x')).toEqual({ maxAgeMs: 6 * 3600_000, exclude: 'sess-x' });
  });
  it('returns null on a non-positive / non-numeric value (no accidental reap-all)', () => {
    expect(ttlSweepOpts('0', 'sess-x')).toBeNull();
    expect(ttlSweepOpts('-2', 'sess-x')).toBeNull();
    expect(ttlSweepOpts('abc', 'sess-x')).toBeNull();
  });
});
