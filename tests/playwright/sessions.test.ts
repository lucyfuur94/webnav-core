import { describe, it, expect } from 'vitest';
import { inventorySessions, planReap } from '../../src/playwright/sessions.js';

// A fake `ps` listing: each line is the daemon command with its --daemon-session path.
const psLines = [
  'run-cli-server --daemon-session=/cache/daemon/abc/walk-1.session',
  'run-cli-server --daemon-session=/cache/daemon/abc/bench-a2.session',
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
});
