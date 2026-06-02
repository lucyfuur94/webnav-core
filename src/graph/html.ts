import type { GraphView } from './export.js';

/**
 * Build a self-contained interactive HTML page visualizing the internet graph.
 *
 * PURE function (GraphView -> HTML string) so it is unit-testable without a
 * browser. The browser-only behavior (Cytoscape rendering, the teach forms) is
 * verified by opening the file.
 *
 * The GraphView JSON is inlined inside a <script type="application/json"> block
 * and parsed at runtime with JSON.parse. We escape any '<' in the serialized
 * JSON to '<' so a node id/url containing the literal "</script>" cannot
 * break out of the data block (defensive — ids/urls are controlled, but free).
 */
export function renderGraphHtml(view: GraphView, opts: { live?: boolean } = {}): string {
  // JSON.stringify of the whole view, with '<' neutralized so neither
  // "</script>" nor "<!--" can terminate the embedding script block.
  const data = JSON.stringify(view).replace(/</g, '\\u003c');
  const live = opts.live === true;

  const siteCount = view.nodes.length;
  const clusterCount = view.clusters.length;
  const edgeCount = view.edges.length;

  const liveScript = live ? `
  // --- Live mode: drill into a node's interior on click. ---
  var LIVE = true;
  var GRAPH_API = '/api/graph'; // canonical refresh endpoint (initial render uses embedded data)
  function renderInterior(nodeId, interior) {
    var cyDiv = document.getElementById('cy');
    var overlay = document.getElementById('interior-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'interior-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:#0f1115;z-index:10;display:flex;flex-direction:column;';
    var bar = document.createElement('div');
    bar.style.cssText = 'padding:8px 12px;color:#e6e6e6;font-size:13px;border-bottom:1px solid #2a2f3a;';
    bar.innerHTML = '<button id="interior-back" style="margin-right:10px;cursor:pointer;">back</button><span id="interior-title"></span>';
    var box = document.createElement('div');
    box.id = 'interior-cy';
    box.style.cssText = 'flex:1 1 auto;min-height:0;';
    overlay.appendChild(bar); overlay.appendChild(box);
    cyDiv.appendChild(overlay);
    document.getElementById('interior-back').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('interior-title').textContent =
      nodeId + ' - ' + interior.states.length + ' states, ' + interior.edges.length + ' edges';
    if (!interior.states.length) {
      box.innerHTML = '<p style="color:#9aa4b2;padding:24px;">No interior mapped for this site yet.</p>';
      return;
    }
    var els = [];
    interior.states.forEach(function (s) {
      els.push({ data: { id: s.id, label: s.semanticName + ' (' + s.role + ')' } });
    });
    interior.edges.forEach(function (e, i) {
      els.push({ data: { id: 'ie' + i, source: e.from, target: e.to, label: e.semanticStep } });
    });
    var icy = cytoscape({ container: box, elements: els,
      style: [
        { selector: 'node', style: { 'background-color': '#4e79a7', 'label': 'data(label)',
          'color': '#e6e6e6', 'font-size': 9, 'text-wrap': 'wrap', 'text-valign': 'bottom', 'text-margin-y': 4 } },
        { selector: 'edge', style: { 'width': 1.5, 'line-color': '#54607a',
          'target-arrow-color': '#54607a', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier',
          'label': 'data(label)', 'font-size': 7, 'color': '#9aa4b2', 'text-rotation': 'autorotate' } }
      ] });
    try { icy.layout({ name: (window.cytoscapeFcose ? 'fcose' : 'cose'), animate: false, fit: true, padding: 30 }).run(); }
    catch (e) { icy.layout({ name: 'cose', animate: false, fit: true, padding: 30 }).run(); }
  }
  cy.on('tap', 'node', function (evt) {
    var id = evt.target.id();
    fetch('/api/node/' + encodeURIComponent(id) + '/interior')
      .then(function (r) { return r.json(); })
      .then(function (interior) { renderInterior(id, interior); })
      .catch(function (e) { showError('Failed to load interior: ' + e); });
  });
` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>webnav — map of known sites</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  #app { display: flex; height: 100vh; width: 100vw; overflow: hidden; }
  #cy { flex: 1 1 auto; min-width: 0; background: #0f1115; }
  #sidebar { flex: 0 0 320px; width: 320px; overflow-y: auto; padding: 16px; background: #171a21; color: #e6e6e6; border-left: 1px solid #2a2f3a; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .counts { font-size: 12px; color: #9aa4b2; margin: 0 0 16px; }
  .section { margin-bottom: 20px; }
  .section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #9aa4b2; margin: 0 0 8px; border-bottom: 1px solid #2a2f3a; padding-bottom: 4px; }
  .muted { color: #9aa4b2; font-size: 12px; }
  .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; margin: 4px 0; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; }
  .node-info dt { font-size: 11px; text-transform: uppercase; color: #9aa4b2; margin-top: 8px; }
  .node-info dd { margin: 2px 0 0; font-size: 13px; word-break: break-word; }
  .node-info a { color: #6fb1ff; }
  form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  form label { font-size: 11px; color: #9aa4b2; }
  form input, form select { background: #0f1115; color: #e6e6e6; border: 1px solid #2a2f3a; border-radius: 4px; padding: 5px 7px; font-size: 13px; }
  form button { background: #2d6cdf; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
  form button:hover { background: #3b7df0; }
  .cmd-box { width: 100%; background: #0f1115; color: #8ce99a; border: 1px solid #2a2f3a; border-radius: 4px; padding: 6px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; margin-top: 6px; resize: vertical; }
  .hint { font-size: 11px; color: #9aa4b2; margin: 0 0 6px; }
  #err { display: none; padding: 24px; color: #ffb4b4; font-family: ui-monospace, monospace; font-size: 14px; }
</style>
</head>
<body>
<div id="app">
  <div id="cy"><div id="err"></div></div>
  <aside id="sidebar">
    <h1>webnav — map of known sites</h1>
    <p class="counts">${siteCount} sites · ${clusterCount} clusters · ${edgeCount} edges</p>

    <div class="section">
      <h2>Selection</h2>
      <div id="node-info"><p class="muted">Click a node to inspect it.</p></div>
    </div>

    <div class="section">
      <h2>Legend (cluster → color)</h2>
      <div id="legend"><p class="muted">—</p></div>
    </div>

    <div class="section">
      <h2>Teach: add node</h2>
      <p class="hint">Run this command to persist:</p>
      <form id="add-node-form">
        <label>id <input name="id" placeholder="npmjs.com" required /></label>
        <label>url <input name="url" placeholder="https://www.npmjs.com" /></label>
        <label>capabilities (csv) <input name="capabilities" placeholder="package-search" /></label>
        <label>topics (csv) <input name="topics" placeholder="javascript,packages" /></label>
        <button type="submit">Generate command + add to graph</button>
      </form>
      <textarea id="add-node-cmd" class="cmd-box" rows="2" readonly placeholder="webnav add-node ..."></textarea>
    </div>

    <div class="section">
      <h2>Teach: add edge</h2>
      <p class="hint">Run this command to persist:</p>
      <form id="add-edge-form">
        <label>from <input name="from" placeholder="github.com" required /></label>
        <label>to <input name="to" placeholder="pypi.org" required /></label>
        <label>kind
          <select name="kind">
            <option value="capability">capability</option>
            <option value="hyperlink">hyperlink</option>
            <option value="co-use">co-use</option>
            <option value="content">content</option>
          </select>
        </label>
        <button type="submit">Generate command + add to graph</button>
      </form>
      <textarea id="add-edge-cmd" class="cmd-box" rows="2" readonly placeholder="webnav add-edge ..."></textarea>
    </div>
  </aside>
</div>

<script type="application/json" id="graph-data">${data}</script>
<script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/layout-base@2/layout-base.js"></script>
<script src="https://unpkg.com/cose-base@2/cose-base.js"></script>
<script src="https://unpkg.com/cytoscape-fcose@2/cytoscape-fcose.js"></script>
<script>
// Register the fcose layout. The UMD bundle needs layout-base + cose-base
// loaded first (above) or it throws on load; even then it does not always
// self-register, so register explicitly. Guarded so a CDN/load failure here
// can't crash the viewer — runLayout() falls back to the built-in 'cose'.
try {
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeFcose !== 'undefined') {
    cytoscape.use(cytoscapeFcose);
  }
} catch (e) { /* fall back to cose */ }
</script>
<script>
(function () {
  'use strict';

  function showError(msg) {
    var box = document.getElementById('err');
    if (box) { box.style.display = 'block'; box.textContent = msg; }
  }

  var GRAPH;
  try {
    GRAPH = JSON.parse(document.getElementById('graph-data').textContent);
  } catch (e) {
    showError('Failed to parse embedded graph data: ' + e);
    return;
  }

  if (typeof cytoscape === 'undefined') {
    showError('Cytoscape failed to load from the CDN. This viewer needs network access to unpkg.com the first time it is opened.');
    return;
  }

  // Deterministic palette keyed by distinct cluster name.
  var PALETTE = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'];
  var clusterColor = {};
  var distinctClusters = GRAPH.clusters && GRAPH.clusters.length
    ? GRAPH.clusters.slice()
    : [];
  // Ensure 'uncategorized' has a color even if not in clusters list.
  distinctClusters.forEach(function (c, i) { clusterColor[c] = PALETTE[i % PALETTE.length]; });
  function colorFor(cluster) {
    if (!clusterColor[cluster]) {
      var idx = Object.keys(clusterColor).length;
      clusterColor[cluster] = PALETTE[idx % PALETTE.length];
    }
    return clusterColor[cluster];
  }

  // Build elements. One node per GRAPH.nodes; one edge per GRAPH.edges,
  // skipping edges whose endpoints are missing so a malformed export
  // cannot crash the render.
  var nodeIds = {};
  var elements = [];
  (GRAPH.nodes || []).forEach(function (n) {
    var cluster = (n.capabilities && n.capabilities[0]) || 'uncategorized';
    nodeIds[n.id] = true;
    elements.push({ data: {
      id: n.id, label: n.id, cluster: cluster,
      homeUrl: n.homeUrl || '', capabilities: n.capabilities || [], topics: n.topics || []
    }});
  });
  (GRAPH.edges || []).forEach(function (e, i) {
    if (!nodeIds[e.from] || !nodeIds[e.to]) return; // guard malformed edges
    elements.push({ data: { id: 'e' + i + '_' + e.from + '_' + e.to, source: e.from, target: e.to, label: e.kind } });
  });

  var cy;
  try {
    cy = cytoscape({
      container: document.getElementById('cy'),
      elements: elements,
      style: [
        { selector: 'node', style: {
          'background-color': function (ele) { return colorFor(ele.data('cluster')); },
          'label': 'data(label)', 'color': '#e6e6e6', 'font-size': 10,
          'text-valign': 'bottom', 'text-margin-y': 4, 'width': 26, 'height': 26
        }},
        { selector: 'edge', style: {
          'width': 1.5, 'line-color': '#54607a', 'target-arrow-color': '#54607a',
          'target-arrow-shape': 'triangle', 'curve-style': 'bezier',
          'label': 'data(label)', 'font-size': 8, 'color': '#9aa4b2', 'text-rotation': 'autorotate'
        }},
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } }
      ]
    });
  } catch (e) {
    showError('Cytoscape failed to initialize: ' + e);
    return;
  }

  function runLayout() {
    var name = (typeof cytoscape !== 'undefined' && cy.layout)
      ? ((window.cytoscapeFcose || hasFcose()) ? 'fcose' : 'cose')
      : 'cose';
    var opts;
    try {
      opts = { name: name, animate: false, fit: true, padding: 30 };
      cy.layout(opts).run();
    } catch (e) {
      // fcose may be registered but still throw; fall back to cose.
      try { cy.layout({ name: 'cose', animate: false, fit: true, padding: 30 }).run(); }
      catch (e2) { /* leave default positions */ }
    }
    cy.fit(undefined, 30);
  }
  function hasFcose() {
    // cytoscape-fcose self-registers via cytoscape.use when loaded as a UMD
    // script. There is no robust public flag, so probe by attempting a layout
    // name; if unsupported, cy.layout throws and runLayout's catch handles it.
    return true;
  }

  runLayout();

  // --- Side panel: inspect a node ---
  var info = document.getElementById('node-info');
  function showNode(d) {
    var caps = (d.capabilities || []).join(', ') || '—';
    var topics = (d.topics || []).join(', ') || '—';
    var url = d.homeUrl || '';
    var urlHtml = url ? '<a href="' + url + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>' : '—';
    info.innerHTML =
      '<dl class="node-info">' +
      '<dt>id</dt><dd>' + escapeHtml(d.id) + '</dd>' +
      '<dt>home url</dt><dd>' + urlHtml + '</dd>' +
      '<dt>cluster</dt><dd>' + escapeHtml(d.cluster || '—') + '</dd>' +
      '<dt>capabilities</dt><dd>' + escapeHtml(caps) + '</dd>' +
      '<dt>topics</dt><dd>' + escapeHtml(topics) + '</dd>' +
      '</dl>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  cy.on('tap', 'node', function (evt) { showNode(evt.target.data()); });
  cy.on('mouseover', 'node', function (evt) { showNode(evt.target.data()); });

  // --- Legend ---
  var legend = document.getElementById('legend');
  var legendClusters = distinctClusters.length ? distinctClusters : Object.keys(clusterColor);
  if (legendClusters.length) {
    legend.innerHTML = legendClusters.map(function (c) {
      return '<div class="legend-item"><span class="swatch" style="background:' + colorFor(c) + '"></span>' + escapeHtml(c) + '</div>';
    }).join('');
  }

  // --- Teach: add node ---
  function csvArg(flag, value) {
    var v = (value || '').trim();
    return v ? ' ' + flag + ' ' + v : '';
  }
  document.getElementById('add-node-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var id = f.id.value.trim();
    var url = f.url.value.trim();
    var caps = f.capabilities.value.trim();
    var topics = f.topics.value.trim();
    if (!id) return;
    var cmd = 'webnav add-node ' + id +
      (url ? ' --url ' + url : '') +
      csvArg('--capabilities', caps) +
      csvArg('--topics', topics);
    document.getElementById('add-node-cmd').value = cmd;
    // Optimistic in-browser add (only if not already present).
    if (!cy.getElementById(id).nonempty()) {
      var capsArr = caps ? caps.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      var cluster = capsArr[0] || 'uncategorized';
      cy.add({ group: 'nodes', data: {
        id: id, label: id, cluster: cluster, homeUrl: url,
        capabilities: capsArr, topics: topics ? topics.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : []
      }});
      if (legendClusters.indexOf(cluster) === -1) { legendClusters.push(cluster); }
      legend.innerHTML = legendClusters.map(function (c) {
        return '<div class="legend-item"><span class="swatch" style="background:' + colorFor(c) + '"></span>' + escapeHtml(c) + '</div>';
      }).join('');
      runLayout();
    }
  });

  // --- Teach: add edge ---
  document.getElementById('add-edge-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var from = f.from.value.trim();
    var to = f.to.value.trim();
    var kind = f.kind.value;
    if (!from || !to) return;
    var cmd = 'webnav add-edge ' + from + ' ' + to + ' --kind ' + kind;
    document.getElementById('add-edge-cmd').value = cmd;
    // Optimistic add only if both nodes exist in the current graph.
    if (cy.getElementById(from).nonempty() && cy.getElementById(to).nonempty()) {
      cy.add({ group: 'edges', data: {
        id: 'ue_' + from + '_' + to + '_' + kind + '_' + Date.now(),
        source: from, target: to, label: kind
      }});
      runLayout();
    }
  });
${liveScript}})();
</script>
</body>
</html>
`;
}
