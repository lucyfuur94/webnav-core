import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout.js';

describe('layoutGraph', () => {
  it('positions every interior node and types non-self edges as orthogonal', async () => {
    const nodes = [
      { id: 'gh:search', label: 'search' },
      { id: 'gh:detail', label: 'detail' },
    ];
    const edges = [{ id: 'e1', source: 'gh:search', target: 'gh:detail', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
    }
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].source).toBe('gh:search');
    expect(out.edges[0].type).toBe('orthogonal');
    // Canonical handle wiring: incoming edges land on one of the node's three target
    // handles ('in-top'/'in-left'/'in-bottom'), chosen by geometry. A single forward
    // edge lands on one of them.
    expect(['in-top', 'in-left', 'in-bottom']).toContain(out.edges[0].targetHandle);
  });

  it('drops the old hand-rolled lane/reciprocalOffset geometry from edge data', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false },
      { id: 'e2', source: 'a', target: 'c', fork: false },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    for (const e of out.edges) {
      expect((e.data as any).lane).toBeUndefined();
      expect((e.data as any).reciprocalOffset).toBeUndefined();
    }
  });

  it('types a self-edge (from===to) as a selfloop', async () => {
    const nodes = [{ id: 'a', label: 'a' }];
    const edges = [{ id: 'e1', source: 'a', target: 'a', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].type).toBe('selfloop');
  });

  it('attaches a real via-affordance to its source PORT handle but not a synthetic edge:* via', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, viaAffordance: 'aff_cart' },
      { id: 'e2', source: 'a', target: 'b', fork: false, viaAffordance: 'edge:synthetic' },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    const real = out.edges.find((e) => e.id === 'e1')!;
    const synth = out.edges.find((e) => e.id === 'e2')!;
    // real via → sourceHandle on the pink affordance port; both land on one of the
    // three geometry-chosen target handles.
    expect(real.sourceHandle).toBe('aff_aff_cart');
    expect(synth.sourceHandle).toBeUndefined();
    expect(['in-top', 'in-left', 'in-bottom']).toContain(real.targetHandle);
    expect(['in-top', 'in-left', 'in-bottom']).toContain(synth.targetHandle);
  });

  it('materialises a synthetic "?" target node for a dangling edge', async () => {
    const nodes = [{ id: 'a', label: 'a' }];
    const edges = [
      { id: 'e1', source: 'a', target: null, fork: false, dangling: true, viaAffordance: 'aff_about' },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    // original node + one synthetic unexplored node
    expect(out.nodes).toHaveLength(2);
    const synth = out.nodes.find((n) => n.type === 'unexplored')!;
    expect(synth).toBeTruthy();
    expect(out.edges[0].target).toBe(synth.id);
    expect((out.edges[0].data as any).dashed).toBe(true);
  });

  it('handles a cyclic edge without throwing', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false },
      { id: 'e2', source: 'b', target: 'a', fork: true },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(2);
  });

  it('routes a reciprocal pair (a→b AND b→a) onto DIFFERENT target handles', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false },
      { id: 'e2', source: 'b', target: 'a', fork: false },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    const fwd = out.edges.find((e) => e.id === 'e1')!;
    const rev = out.edges.find((e) => e.id === 'e2')!;
    // forward (down) → in-top; reverse (up) → in-bottom — never the same → no overlap.
    expect(fwd.targetHandle).not.toBe(rev.targetHandle);
  });

  it('carries from/to labels + a stepPosition on each edge for hover + fan-out', async () => {
    const nodes = [{ id: 'a', label: 'Home' }, { id: 'b', label: 'Detail' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    const d = out.edges[0].data as any;
    expect(d.fromLabel).toBe('Home');
    expect(d.toLabel).toBe('Detail');
    expect(typeof d.stepPosition).toBe('number');
    expect(d.hovered).toBe(false);
  });

  it('styles a core edge thicker/full-opacity vs a faded non-core edge', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, core: true },
      { id: 'e2', source: 'a', target: 'c', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const core = out.edges.find((e) => e.id === 'e1')!;
    const non = out.edges.find((e) => e.id === 'e2')!;
    expect((core.style as any).strokeWidth).toBeGreaterThan((non.style as any).strokeWidth);
    expect((non.style as any).opacity).toBeLessThan(1);
  });

  it('places a reveal SUB-NODE beside its parent and styles the reveal edge purple/dashed', async () => {
    const nodes = [
      { id: 'inv', label: 'inventory', badges: 2 },
      { id: 'inv::r', label: 'burger menu open', badges: 4, sub: true, subParent: 'inv' },
    ];
    const edges = [
      // parent → sub reveal edge, anchored to the burger affordance port
      { id: 'rev0', source: 'inv', target: 'inv::r', fork: false, reveal: true, viaAffordance: 'aff_burger' },
      // a child option leaving the SUB-NODE
      { id: 'e0', source: 'inv::r', target: 'inv', fork: false, viaAffordance: 'aff_all' },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const parent = out.nodes.find((n) => n.id === 'inv')!;
    const sub = out.nodes.find((n) => n.id === 'inv::r')!;
    // sub-node sits to the RIGHT of its parent, roughly level with it
    expect(sub.position.x).toBeGreaterThan(parent.position.x);
    expect(Math.abs(sub.position.y - parent.position.y)).toBeLessThan(60);
    expect((sub.data as any).sub).toBe(true);
    // reveal edge: purple, dashed, anchored to the burger affordance source port
    const rev = out.edges.find((e) => e.id === 'rev0')!;
    expect((rev.data as any).color).toBe('#7c3aed');
    expect((rev.data as any).dashed).toBe(true);
    expect(rev.sourceHandle).toBe('aff_aff_burger');
    // child edge leaves the sub-node
    expect(out.edges.find((e) => e.id === 'e0')!.source).toBe('inv::r');
  });

  it('falls back to a grid if a node is malformed (no throw, all positioned)', async () => {
    const nodes = [{ id: 'x', label: 'x' }, { id: 'x', label: 'x-dup' }];
    const edges: { id: string; source: string; target: string; fork: boolean }[] = [];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) expect(typeof n.position.x).toBe('number');
  });
});
