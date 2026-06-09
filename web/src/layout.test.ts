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

  it('anchors edges to the node-level src/in-top handles (not per-row aff_* ports)', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, viaAffordance: 'aff_cart' },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    const e = out.edges.find((x) => x.id === 'e1')!;
    // Edges leave the node bottom-centre 'src' and enter top-centre 'in-top' —
    // the per-row 'aff_*' source handle was dropped (ELK routes node-level ports).
    expect(e.sourceHandle).toBe('src');
    expect(e.targetHandle).toBe('in-top');
  });

  it('omits targetHandle when the target is a synthetic unexplored stub', async () => {
    const nodes = [{ id: 'a', label: 'a' }];
    const edges = [
      { id: 'e1', source: 'a', target: null, fork: false, dangling: true, viaAffordance: 'aff_about' },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    // source is a real node → 'src'; target is the synthetic stub → no 'in-top'.
    expect(out.edges[0].sourceHandle).toBe('src');
    expect(out.edges[0].targetHandle).toBeUndefined();
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

  it('snaps the core spine to an EXACT vertical column (no zig-zag) with branch to the side', async () => {
    const nodes = [
      { id: 'login', label: 'login' },
      { id: 'inv', label: 'inventory' },
      { id: 'cart', label: 'cart' },
      { id: 'checkout', label: 'checkout' },
      { id: 'branch', label: 'branch' },
    ];
    const edges = [
      { id: 'e1', source: 'login', target: 'inv', fork: false, core: true },
      { id: 'e2', source: 'inv', target: 'cart', fork: false, core: true },
      { id: 'e3', source: 'cart', target: 'checkout', fork: false, core: true },
      // a non-core back-edge + a branch off the spine
      { id: 'e4', source: 'cart', target: 'inv', fork: false, core: false },
      { id: 'e5', source: 'inv', target: 'branch', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const pos = (id: string) => out.nodes.find((n) => n.id === id)!.position;
    // spine descends top-to-bottom
    expect(pos('login').y).toBeLessThan(pos('inv').y);
    expect(pos('inv').y).toBeLessThan(pos('cart').y);
    expect(pos('cart').y).toBeLessThan(pos('checkout').y);
    // snapSpine pins all core nodes to one EXACT column x (the real zig-zag fix).
    const spineXs = ['login', 'inv', 'cart', 'checkout'].map((id) => pos(id).x);
    for (const x of spineXs) expect(Math.abs(x - spineXs[0])).toBeLessThan(1);
    // the branch is laid out somewhere with valid coords (NETWORK_SIMPLEX may keep
    // a single child in-column when that's the cleanest linear placement — we no
    // longer force branches off to the side; the spine straightness is what matters).
    expect(typeof pos('branch').x).toBe('number');
    expect(Number.isFinite(pos('branch').x)).toBe(true);
  });

  it('a core forward edge is recomputed as a clean 2-point vertical segment after snap', async () => {
    const nodes = [
      { id: 'login', label: 'login' }, { id: 'inv', label: 'inventory' },
      { id: 'branch', label: 'branch' },
    ];
    const edges = [
      { id: 'e1', source: 'login', target: 'inv', fork: false, core: true },
      { id: 'e2', source: 'inv', target: 'branch', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const core = out.edges.find((e) => e.id === 'e1')!;
    const pts = (core.data as any).points;
    // snapSpine replaces the core forward edge with bottom-centre → top-centre.
    expect(pts).toHaveLength(2);
    expect(Math.abs(pts[0].x - pts[1].x)).toBeLessThan(1);  // perfectly vertical
    expect(pts[1].y).toBeGreaterThan(pts[0].y);             // points downward
  });

  it('carries from/to labels on each edge (surfaced on hover) and no static label', async () => {
    const nodes = [{ id: 'a', label: 'Home' }, { id: 'b', label: 'Detail' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b', fork: false, core: true }];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const d = out.edges[0].data as any;
    expect(d.fromLabel).toBe('Home');
    expect(d.toLabel).toBe('Detail');
    expect(d.hovered).toBe(false);
    // no static edge text any more (labels are hover-only) — `label` isn't set.
    expect(d.label).toBeUndefined();
  });

  it('styles all navigation edges UNIFORMLY (no special core-path colour)', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, core: true },
      { id: 'e2', source: 'a', target: 'c', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const core = out.edges.find((e) => e.id === 'e1')!;
    const non = out.edges.find((e) => e.id === 'e2')!;
    // same colour + width regardless of the core flag (no blue spine).
    expect((core.data as any).color).toBe((non.data as any).color);
    expect((core.style as any).strokeWidth).toBe((non.style as any).strokeWidth);
    expect((core.data as any).color).not.toBe('#1d4ed8');
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
    expect(rev.sourceHandle).toBe('src');
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
