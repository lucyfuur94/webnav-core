import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Controls, MiniMap, applyNodeChanges,
  useNodesInitialized, useReactFlow,
  type Node, type Edge, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph } from './layout.js';
import { isForkEdge } from './forkEdge.js';
import { synthesizeRevealSubNodes, buildLayoutNodes, buildLayoutEdges } from './revealSubnodes.js';
import { StateNode } from './nodes/StateNode.js';
import { UnexploredNode } from './nodes/UnexploredNode.js';
import { RoutedEdge, SelfLoopEdge } from './edges/RoutedEdge.js';
import { neighborSet, nodeOpacity, edgeActive } from './highlight.js';
import { useTheme } from './useTheme.js';
import type { NodeInteriorView } from './types.js';

const nodeTypes = { state: StateNode, unexplored: UnexploredNode };
const edgeTypes = { routed: RoutedEdge, selfloop: SelfLoopEdge };
const DIM = 0.18;   // opacity for nodes NOT adjacent to the hovered node


// Inner component — runs INSIDE a ReactFlowProvider so it can use useReactFlow /
// useNodesInitialized for the measured two-pass layout.
function InteriorViewInner({ id, onBack }: { id: string; onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // id of the edge currently hovered. When set, that edge is highlighted and
  // everything else (other edges + non-endpoint nodes) is dimmed.
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  // Per-node expanded reveal overlays (Change 3). Keyed 'stateId::affId'. Empty =
  // every overlay collapsed (default). Toggling re-runs layout so the overlay
  // sub-node + its edges appear/disappear.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Light/dark theme — shared + persisted (survives navigation / reload / session)
  // via the useTheme hook; drives React Flow colorMode + our chrome/node colors.
  const { dark, toggle: toggleDark } = useTheme();

  // Keep the raw interior data so a reveal toggle can re-layout without re-fetching.
  const ivRef = useRef<NodeInteriorView | null>(null);
  // Layout "generation": bumped on every ESTIMATED-size pass (initial load OR an
  // expand/collapse). The measure-pass effect re-lays out a generation exactly
  // ONCE — once React Flow has measured ALL of that generation's nodes — by
  // recording the last generation it measured. This is what makes expand work:
  // a new overlay sub-node forces a fresh generation, so its true size is fed back
  // to ELK before final placement (no stale-size overlap).
  const layoutGen = useRef(0);
  const measuredGen = useRef(-1);

  const nodesInitialized = useNodesInitialized();
  const { getNodes, fitView } = useReactFlow();

  // Let the user DRAG nodes around: React Flow emits position/selection changes;
  // apply them back to our base `nodes` state.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  // Toggle an overlay open/closed for a given parent state. `affId` is the raw
  // reveal affordance id on that node; we scope the key by the node id so the same
  // affordance id on two nodes toggles independently.
  const onToggleReveal = useCallback((stateId: string, affId: string) => {
    setExpanded((prev) => {
      const key = stateId + '::' + affId;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Build (or rebuild) the laid-out graph from the raw interior + current expanded
  // set. Re-runs whenever the interior loads or an overlay is toggled.
  //
  // TWO-PASS (documented pattern): the first call has no `measured` map, so ELK
  // lays out with ESTIMATED node sizes (badges) — good enough to render. Once React
  // Flow has measured the rendered nodes, the measure-pass effect calls this again
  // with a `measured` map of the true {w,h}, so ELK re-runs with exact sizes and its
  // ports/edge-routes land precisely. `measurePending` gates the re-run to once.
  const buildGraph = useCallback(async (iv: NodeInteriorView, measured?: Map<string, { w: number; h: number }>) => {
    const isExpanded = (ownerId: string, affId: string) => expanded.has(ownerId + '::' + affId);

    // ── Reveal sub-node synthesis (VIEWER-ONLY; see revealSubnodes.ts) ──
    // Overlays are COLLAPSED by default; a sub-node + its edges are materialised
    // ONLY for an expanded reveal. Collapsed overlay child edges are dropped.
    const { subStates, revealEdges, childOwner, overlayChildIds } =
      synthesizeRevealSubNodes(iv.states, isExpanded);
    const ln = buildLayoutNodes(iv.states, subStates).map((n) => {
      const m = measured?.get(n.id);
      return m ? { ...n, w: m.w, h: m.h } : n;
    });
    const le = buildLayoutEdges(iv.edges, revealEdges, childOwner, isForkEdge, overlayChildIds);

    // An estimated pass (no measured map) starts a NEW generation that still owes a
    // measured re-layout; a measured pass does not bump the generation.
    if (!measured) layoutGen.current += 1;
    const laid = await layoutGraph(ln, le, 'interior');
    const meta = new Map<string, { role: string; availableSignals: string[]; affordances: any[]; sub?: boolean }>(
      iv.states.map((s) => [s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances }]),
    );
    for (const s of subStates) meta.set(s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances, sub: true });

    setNodes(laid.nodes.map((nd) => {
      const s = meta.get(nd.id);
      if (!s) return nd;  // synthetic unexplored node — leave data as-is
      // expandedReveals for THIS node: the raw aff ids expanded on it.
      const nodeExpanded = new Set<string>();
      for (const key of expanded) {
        const sep = key.lastIndexOf('::');
        if (sep > 0 && key.slice(0, sep) === nd.id) nodeExpanded.add(key.slice(sep + 2));
      }
      return {
        ...nd,
        data: {
          ...nd.data, role: s.role, signals: s.availableSignals, affordances: s.affordances,
          sub: s.sub === true,
          expandedReveals: nodeExpanded,
          onToggleReveal: (affId: string) => onToggleReveal(nd.id, affId),
        },
      };
    }));
    setEdges(laid.edges);
  }, [expanded, onToggleReveal]);

  useEffect(() => {
    // A 404 (unknown node) throws in fetchInterior — distinguish "no interior yet"
    // from a real API failure.
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }
      ivRef.current = iv;
      await buildGraph(iv);
    }).catch((e) => {
      if (String(e).includes('404')) setEmpty(true);
      else setError(String(e));
    });
    // buildGraph is intentionally NOT a dep here — the toggle effect handles rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Rebuild the graph when an overlay is expanded/collapsed (raw data is cached).
  useEffect(() => {
    if (ivRef.current) void buildGraph(ivRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // MEASURE PASS (documented two-pass): once React Flow reports ALL current nodes
  // measured (useNodesInitialized) AND this generation hasn't been measured yet,
  // read the true sizes and re-run the layout ONCE with them so ELK's ports + edge
  // routes land on the real borders. Keying on the generation (not a one-shot flag)
  // is what makes EXPAND correct: each expand bumps the generation, so the new
  // overlay sub-node's true size is measured and fed back before final placement.
  useEffect(() => {
    if (!nodesInitialized || !ivRef.current) return;
    if (measuredGen.current >= layoutGen.current) return;  // already measured this gen
    measuredGen.current = layoutGen.current;               // claim it (prevents loop)
    const measured = new Map<string, { w: number; h: number }>();
    for (const n of getNodes()) {
      const w = n.measured?.width, h = n.measured?.height;
      if (w && h) measured.set(n.id, { w, h });
    }
    if (measured.size) {
      void buildGraph(ivRef.current, measured).then(() => fitView({ padding: 0.18, duration: 200 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, nodes]);

  // The two endpoints of the hovered edge (for node dimming when an edge is hovered).
  const edgeEndpoints = useMemo(() => {
    if (!hoveredEdge) return null;
    const e = edges.find((x) => x.id === hoveredEdge);
    return e ? new Set<string>([e.source, e.target]) : null;
  }, [hoveredEdge, edges]);

  const neighbors = useMemo(() => neighborSet(hovered, edges.map((e) => ({ source: e.source, target: e.target }))), [hovered, edges]);

  const shownNodes = useMemo(() => nodes.map((n) => {
    const opacity = edgeEndpoints
      ? (edgeEndpoints.has(n.id) ? 1 : DIM)
      : nodeOpacity(n.id, neighbors, DIM);
    // Thread `dark` into node data here (no re-layout needed) so StateNode can
    // theme its own colours — React Flow's colorMode only themes the canvas/chrome.
    return { ...n, data: { ...n.data, dark },
      style: { ...(n.style || {}), opacity, transition: 'opacity 120ms' } };
  }), [nodes, neighbors, edgeEndpoints, dark]);

  // Edges read opacity + the hovered flag from data. (All edges are the single
  // orthogonal 'step' shape — straight segments with curved bends only where the
  // route turns; no connector toggle.)
  const shownEdges = useMemo(() => edges.map((e) => {
    const base = e.data || {};
    if (hoveredEdge) {
      const isHovered = e.id === hoveredEdge;
      return { ...e, data: { ...base, dimmed: !isHovered, hovered: isHovered } };
    }
    const active = edgeActive({ source: e.source, target: e.target }, hovered);
    return { ...e, data: { ...base, dimmed: !active, hovered: false } };
  }), [edges, hovered, hoveredEdge]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button onClick={onBack} style={{ position: 'absolute', zIndex: 10, top: 12, left: 12,
        padding: '6px 10px', fontFamily: 'sans-serif', cursor: 'pointer' }}>← back to map</button>

      {/* Top-right control: dark-mode toggle. */}
      {!error && !empty ? (
        <div style={{ position: 'absolute', zIndex: 10, top: 12, right: 12, display: 'flex',
          alignItems: 'center', gap: 10, fontFamily: 'sans-serif' }}>
          <button
            aria-label="toggle dark mode" aria-pressed={dark} onClick={toggleDark}
            title={dark ? 'Switch to light' : 'Switch to dark'}
            style={{ padding: '5px 10px', fontSize: 14, cursor: 'pointer', borderRadius: 8,
              border: `1px solid ${dark ? '#334155' : '#cbd5e1'}`,
              background: dark ? '#1e293b' : '#fff', color: dark ? '#fbbf24' : '#334155',
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)', lineHeight: 1 }}
          >
            {dark ? '☀' : '☾'}
          </button>
        </div>
      ) : null}

      {error
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif', color: '#334155' }}>Couldn't load the interior for <b>{id}</b>: {error}</div>
        : empty
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif' }}>No interior recorded for <b>{id}</b> yet. Map it with a record session.</div>
        : <ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            colorMode={dark ? 'dark' : 'light'}
            fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.05}
            onNodesChange={onNodesChange}
            onNodeMouseEnter={(_, n) => { setHovered(n.id); setHoveredEdge(null); }}
            onNodeMouseLeave={() => setHovered(null)}
            onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            // Clear an edge-hover only when the cursor lands on the empty pane (a
            // genuine "left all edges" signal). onPaneMouseMove fires for the
            // background, NOT while over an edge's hit-area, so it no longer races
            // with edge hover the way a global mousemove would.
            onPaneMouseEnter={() => setHoveredEdge(null)}>
            {/* No <Background> → a clean flat canvas (no dot grid). React Flow's
                colorMode handles the canvas/controls/minimap theming. */}
            <Controls /><MiniMap pannable zoomable />
          </ReactFlow>}
    </div>
  );
}

// Public component: wraps the inner view in a ReactFlowProvider so it can use
// useReactFlow / useNodesInitialized for the measured two-pass layout.
export function InteriorView(props: { id: string; onBack: () => void }): JSX.Element {
  return (
    <ReactFlowProvider>
      <InteriorViewInner {...props} />
    </ReactFlowProvider>
  );
}
