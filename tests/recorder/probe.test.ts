import { describe, it, expect, vi } from 'vitest';
import { PROBE_ROLES, namelessInteractive, probeNames } from '../../src/recorder/probe.js';
import type { SnapNode } from '../../src/playwright/snapshot.js';

function node(over: Partial<SnapNode>): SnapNode {
  return { role: 'button', name: null, ref: 'e1', url: null, raw: '', depth: 0, ...over };
}

describe('namelessInteractive', () => {
  it('picks only nameless + ref + role-in-PROBE_ROLES nodes', () => {
    const nodes: SnapNode[] = [
      node({ ref: 'e1', role: 'button', name: null }),         // keep: nameless button
      node({ ref: 'e2', role: 'button', name: 'Save' }),        // drop: named
      node({ ref: null, role: 'button', name: null }),          // drop: no ref
      node({ ref: 'e4', role: 'generic', name: null }),         // drop: role not in PROBE_ROLES
      node({ ref: 'e5', role: 'link', name: '' }),               // keep: empty-string name counts as nameless
      node({ ref: 'e6', role: 'link', name: '   ' }),             // keep: whitespace-only counts as nameless
    ];
    const picked = namelessInteractive(nodes);
    expect(picked.map((n) => n.ref)).toEqual(['e1', 'e5', 'e6']);
  });

  it('covers every PROBE_ROLES entry', () => {
    expect([...PROBE_ROLES].sort()).toEqual(
      ['button', 'checkbox', 'link', 'menuitem', 'radio', 'switch', 'tab'].sort()
    );
  });
});

describe('probeNames', () => {
  it('returns hints for probed refs via a fake evalJs', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) => JSON.stringify('Hint for ' + ref));
    const nodes = [node({ ref: 'e1' }), node({ ref: 'e2' })];
    const hints = await probeNames({ evalJs }, nodes);
    expect(hints).toEqual({ e1: 'Hint for e1', e2: 'Hint for e2' });
    expect(evalJs).toHaveBeenCalledTimes(2);
  });

  it('calls evalJs serialized, one ref at a time (not concurrently)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const evalJs = vi.fn(async (_js: string, ref?: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return JSON.stringify('Hint ' + ref);
    });
    const nodes = [node({ ref: 'e1' }), node({ ref: 'e2' }), node({ ref: 'e3' })];
    await probeNames({ evalJs }, nodes);
    expect(maxInFlight).toBe(1);
  });

  it('respects the cap (default 16) — stops issuing evals past it', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) => JSON.stringify('Hint ' + ref));
    const nodes = Array.from({ length: 20 }, (_, i) => node({ ref: 'e' + i }));
    const hints = await probeNames({ evalJs }, nodes);
    expect(evalJs).toHaveBeenCalledTimes(16);
    expect(Object.keys(hints)).toHaveLength(16);
  });

  it('respects an explicit cap override', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) => JSON.stringify('Hint ' + ref));
    const nodes = Array.from({ length: 5 }, (_, i) => node({ ref: 'e' + i }));
    const hints = await probeNames({ evalJs }, nodes, 2);
    expect(evalJs).toHaveBeenCalledTimes(2);
    expect(Object.keys(hints)).toHaveLength(2);
  });

  it('skips a ref whose eval throws — never aborts the batch', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) => {
      if (ref === 'e1') throw new Error('stale ref');
      return JSON.stringify('Hint ' + ref);
    });
    const nodes = [node({ ref: 'e1' }), node({ ref: 'e2' })];
    const hints = await probeNames({ evalJs }, nodes);
    expect(hints).toEqual({ e2: 'Hint e2' });
  });

  it('omits refs whose result is an error blob (rejected by enrichName)', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) =>
      ref === 'e1' ? '### Error: stale ref' : JSON.stringify('Hint ' + ref));
    const nodes = [node({ ref: 'e1' }), node({ ref: 'e2' })];
    const hints = await probeNames({ evalJs }, nodes);
    expect(hints).toEqual({ e2: 'Hint e2' });
  });

  it('omits refs whose probe result is empty', async () => {
    const evalJs = vi.fn(async () => JSON.stringify(''));
    const nodes = [node({ ref: 'e1' })];
    const hints = await probeNames({ evalJs }, nodes);
    expect(hints).toEqual({});
  });

  it('never includes nodes with a null ref (guarded even if caller forgets to filter)', async () => {
    const evalJs = vi.fn(async (_js: string, ref?: string) => JSON.stringify('Hint ' + ref));
    const nodes = [node({ ref: null })];
    const hints = await probeNames({ evalJs }, nodes);
    expect(evalJs).not.toHaveBeenCalled();
    expect(hints).toEqual({});
  });
});
