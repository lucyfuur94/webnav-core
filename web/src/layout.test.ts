import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout.js';

describe('layoutGraph', () => {
  it('positions every interior node and types non-self edges as routed', async () => {
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
    // Edges are now ELK-routed and rendered by the RoutedEdge.
    expect(out.edges[0].type).toBe('routed');
  });

  it('carries an ELK-routed polyline (data.points) + a default step shape', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    const d = out.edges[0].data as any;
    // ELK returns a route (start → bends → end); at least two points.
    expect(Array.isArray(d.points)).toBe(true);
    expect(d.points.length).toBeGreaterThanOrEqual(2);
    for (const p of d.points) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
    }
    expect(d.shape).toBe('step');
  });

  it('drops the old hand-rolled lane/offset/stepPosition geometry from edge data', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false },
      { id: 'e2', source: 'a', target: 'c', fork: false },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    for (const e of out.edges) {
      expect((e.data as any).lane).toBeUndefined();
      expect((e.data as any).reciprocalOffset).toBeUndefined();
      expect((e.data as any).offset).toBeUndefined();
      expect((e.data as any).stepPosition).toBeUndefined();
    }
  });

  it('types a self-edge (from===to) as a selfloop and does not give it to ELK', async () => {
    const nodes = [{ id: 'a', label: 'a' }];
    const edges = [{ id: 'e1', source: 'a', target: 'a', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].type).toBe('selfloop');
    // a self-loop has no ELK route — the SelfLoopEdge draws it from node geometry.
    expect((out.edges[0].data as any).points).toBeUndefined();
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
    expect(real.sourceHandle).toBe('aff_aff_cart');
    expect(synth.sourceHandle).toBeUndefined();
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

  it('keeps the core spine a vertical column (core nodes stacked top-to-bottom)', async () => {
    const nodes = [
      { id: 'login', label: 'login' },
      { id: 'inv', label: 'inventory' },
      { id: 'cart', label: 'cart' },
      { id: 'branch', label: 'branch' },
    ];
    const edges = [
      { id: 'e1', source: 'login', target: 'inv', fork: false, core: true },
      { id: 'e2', source: 'inv', target: 'cart', fork: false, core: true },
      // a non-core back-edge + a branch off the spine
      { id: 'e3', source: 'cart', target: 'inv', fork: false, core: false },
      { id: 'e4', source: 'inv', target: 'branch', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const pos = (id: string) => out.nodes.find((n) => n.id === id)!.position;
    // spine descends: login above inventory above cart
    expect(pos('login').y).toBeLessThan(pos('inv').y);
    expect(pos('inv').y).toBeLessThan(pos('cart').y);
    // spine stays a column: the three core nodes share roughly the same x
    // core nodes share roughly the same x (small ELK centering jitter allowed; the
    // key point is they're a column, NOT spread horizontally like the branch).
    expect(Math.abs(pos('login').x - pos('cart').x)).toBeLessThan(40);
    // and the branch sits clearly to the SIDE of the spine, not in the column.
    expect(Math.abs(pos('branch').x - pos('inv').x)).toBeGreaterThan(100);
  });

  it('carries from/to labels + a core flag on each edge for hover + readability', async () => {
    const nodes = [{ id: 'a', label: 'Home' }, { id: 'b', label: 'Detail' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b', fork: false, core: true }];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const d = out.edges[0].data as any;
    expect(d.fromLabel).toBe('Home');
    expect(d.toLabel).toBe('Detail');
    expect(d.core).toBe(true);
    expect(d.hovered).toBe(false);
  });

  it('styles a core edge bold/full-opacity vs a thin faded non-core back-edge', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, core: true },
      { id: 'e2', source: 'a', target: 'c', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const core = out.edges.find((e) => e.id === 'e1')!;
    const non = out.edges.find((e) => e.id === 'e2')!;
    // core dominates: thicker stroke + full opacity; non-core thin + clearly faded.
    expect((core.style as any).strokeWidth).toBeGreaterThan((non.style as any).strokeWidth);
    expect((core.style as any).opacity).toBe(1);
    expect((non.style as any).opacity).toBeLessThanOrEqual(0.4);
    expect((core.data as any).color).toBe('#1d4ed8');
  });

  it('places a reveal SUB-NODE near its parent and styles the reveal edge purple/dashed', async () => {
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
    expect((sub.data as any).sub).toBe(true);
    // reveal edge: purple, dashed, anchored to the burger affordance source port
    const rev = out.edges.find((e) => e.id === 'rev0')!;
    expect((rev.data as any).color).toBe('#7c3aed');
    expect((rev.data as any).dashed).toBe(true);
    expect(rev.sourceHandle).toBe('aff_aff_burger');
    // child edge leaves the sub-node
    expect(out.edges.find((e) => e.id === 'e0')!.source).toBe('inv::r');
    // both placed (positions are numbers)
    expect(typeof parent.position.x).toBe('number');
    expect(typeof sub.position.x).toBe('number');
  });

  it('falls back to a grid if a node is malformed (no throw, all positioned)', async () => {
    const nodes = [{ id: 'x', label: 'x' }, { id: 'x', label: 'x-dup' }];
    const edges: { id: string; source: string; target: string; fork: boolean }[] = [];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) expect(typeof n.position.x).toBe('number');
  });
});
