import { describe, it, expect } from 'vitest';
import { renderGraphHtml } from '../../src/graph/html.js';

const view = {
  nodes: [
    { id: 'github.com', homeUrl: 'https://github.com', capabilities: ['code-search'], topics: ['code'], clusters: ['code-search'] },
    { id: 'pypi.org', homeUrl: 'https://pypi.org', capabilities: ['package-search'], topics: ['python'], clusters: ['package-search'] },
  ],
  clusters: ['code-search', 'package-search'],
  edges: [{ from: 'github.com', to: 'pypi.org', kind: 'hyperlink', weight: 1 }],
};

describe('renderGraphHtml', () => {
  it('produces a self-contained HTML doc with the graph data inlined', () => {
    const h = renderGraphHtml(view);
    expect(h).toMatch(/<!DOCTYPE html>/i);
    expect(h).toContain('cytoscape'); // loads the lib
    expect(h).toContain('github.com'); // node inlined
    expect(h).toContain('pypi.org'); // edge target inlined (in the JSON block)
    expect(h).toContain('add-node'); // teach command template present
    expect(h).toContain('add-edge');
  });

  it('embeds the GraphView as JSON', () => {
    const h = renderGraphHtml(view);
    expect(h).toContain(JSON.stringify(view));
  });

  it('handles an empty graph without crashing', () => {
    const h = renderGraphHtml({ nodes: [], clusters: [], edges: [] });
    expect(h).toMatch(/<!DOCTYPE html>/i);
  });

  it('loads cytoscape and the fcose layout from a CDN', () => {
    const h = renderGraphHtml(view);
    expect(h).toContain('unpkg.com/cytoscape@3');
    expect(h).toContain('cytoscape-fcose');
  });

  it('shows counts of sites, clusters, and edges', () => {
    const h = renderGraphHtml(view);
    expect(h).toContain('2'); // 2 sites / 2 clusters
    expect(h).toContain('1'); // 1 edge
    expect(h).toMatch(/sites/i);
    expect(h).toMatch(/clusters/i);
  });

  it('escapes any </script> sequence so inlined data cannot break out of the script block', () => {
    const sneaky = {
      nodes: [{ id: '</script><script>alert(1)</script>', homeUrl: 'x', capabilities: [], topics: [], clusters: [] }],
      clusters: [],
      edges: [],
    };
    const h = renderGraphHtml(sneaky);
    // The literal closing-script sequence must not appear unescaped inside the embedded data.
    expect(h).not.toContain('</script><script>alert(1)</script>');
  });
});
