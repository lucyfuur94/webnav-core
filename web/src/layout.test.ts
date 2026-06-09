import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout.js';

describe('layoutGraph', () => {
  it('positions every interior node and types non-self edges as floating', async () => {
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
    expect(out.edges[0].type).toBe('floating');
  });

  it('types a self-edge (from===to) as a selfloop', async () => {
    const nodes = [{ id: 'a', label: 'a' }];
    const edges = [{ id: 'e1', source: 'a', target: 'a', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].type).toBe('selfloop');
  });

  it('anchors a real via-affordance to its row but not a synthetic edge:* via', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, viaAffordance: 'aff_cart' },
      { id: 'e2', source: 'a', target: 'b', fork: false, viaAffordance: 'edge:synthetic' },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    const real = out.edges.find((e) => e.id === 'e1')!;
    const synth = out.edges.find((e) => e.id === 'e2')!;
    expect((real.data as any).sourceAffordanceId).toBe('aff_aff_cart');
    expect((synth.data as any).sourceAffordanceId).toBeUndefined();
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

  it('falls back to a grid if a node is malformed (no throw, all positioned)', async () => {
    const nodes = [{ id: 'x', label: 'x' }, { id: 'x', label: 'x-dup' }];
    const edges: { id: string; source: string; target: string; fork: boolean }[] = [];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) expect(typeof n.position.x).toBe('number');
  });
});
