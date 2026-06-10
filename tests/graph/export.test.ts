import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGitHubAndGraph } from '../../src/graph/seed.js';
import { buildGraphView } from '../../src/graph/export.js';
describe('buildGraphView', () => {
  it('exports nodes, clusters, edges from the seeded graph', () => {
    const s = new MapStore(':memory:'); seedGitHubAndGraph(s);
    const v = buildGraphView(s);
    expect(v.nodes.find(n => n.id === 'github.com')).toBeTruthy();
    expect(v.nodes.find(n => n.id === 'github.com')!.clusters).toContain('code-search');
    expect(v.clusters).toContain('web-search');     // marginalia+duckduckgo cluster
    expect(v.edges.some(e => e.from === 'github.com' && e.to === 'pypi.org' && e.kind === 'hyperlink')).toBe(true);
  });
  it('clusters is the sorted distinct union of node capabilities', () => {
    const s = new MapStore(':memory:'); seedGitHubAndGraph(s);
    const v = buildGraphView(s);
    expect(v.clusters).toEqual([...v.clusters].sort());
    expect(new Set(v.clusters).size).toBe(v.clusters.length);
  });
});
