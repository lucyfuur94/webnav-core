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

  it('loads fcose with its peer deps in order and registers it', () => {
    const h = renderGraphHtml(view);
    // cytoscape-fcose needs layout-base + cose-base loaded before it, or it
    // throws "Cannot read properties of undefined (reading 'layoutBase')" on
    // load and the viewer silently falls back to the plain cose layout.
    const cyIdx = h.indexOf('unpkg.com/cytoscape@3');
    const layoutBaseIdx = h.indexOf('unpkg.com/layout-base');
    const coseBaseIdx = h.indexOf('unpkg.com/cose-base');
    const fcoseIdx = h.indexOf('cytoscape-fcose');
    expect(cyIdx).toBeGreaterThanOrEqual(0);
    expect(layoutBaseIdx).toBeGreaterThanOrEqual(0);
    expect(coseBaseIdx).toBeGreaterThanOrEqual(0);
    // Dependency order: cytoscape -> layout-base -> cose-base -> fcose.
    expect(layoutBaseIdx).toBeGreaterThan(cyIdx);
    expect(coseBaseIdx).toBeGreaterThan(layoutBaseIdx);
    expect(fcoseIdx).toBeGreaterThan(coseBaseIdx);
    // The UMD bundle self-registers on some versions but not reliably; register
    // explicitly, guarded so a load failure can't crash the script.
    expect(h).toContain('cytoscape.use');
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

  it('live mode wires the API endpoints and a drill-in handler', () => {
    const h = renderGraphHtml(view, { live: true });
    expect(h).toContain('/api/graph');
    expect(h).toContain('/api/node/');
    expect(h).toContain('interior');
  });

  it('static mode (default) does NOT fetch the API', () => {
    const h = renderGraphHtml(view);
    expect(h).not.toContain('/api/graph');
  });
});
