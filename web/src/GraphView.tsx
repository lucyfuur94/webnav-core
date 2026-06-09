import { useEffect, useState } from 'react';
import { ReactFlow, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchGraph } from './api.js';
import { layoutGraph } from './layout.js';
import { SiteNode } from './nodes/SiteNode.js';
import { useTheme } from './useTheme.js';

const nodeTypes = { site: SiteNode };

export function GraphView({ onOpen }: { onOpen: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const { dark, toggle: toggleDark } = useTheme();

  useEffect(() => {
    fetchGraph().then(async (g) => {
      if (!g.nodes.length) { setEmpty(true); return; }
      const ln = g.nodes.map((n) => ({ id: n.id, label: n.id }));
      // hyperlink = a real navigable link between sites (solid); every other kind
      // (capability/co-use/content) is an associative relationship (dotted).
      const le = g.edges.map((e, i) => ({
        id: `e${i}`, source: e.from, target: e.to, fork: false,
        associative: e.kind !== 'hyperlink',
      }));
      const laid = await layoutGraph(ln, le, 'clusters');
      const capById = new Map(g.nodes.map((n) => [n.id, n.capabilities]));
      setNodes(laid.nodes.map((nd) => ({ ...nd, data: { ...nd.data, capabilities: capById.get(nd.id) } })));
      setEdges(laid.edges);
    }).catch((e) => setError(String(e)));
  }, []);

  // thread the (persisted) theme into each node so SiteNode can theme itself.
  const themedNodes = nodes.map((n) => ({ ...n, data: { ...n.data, dark } }));

  if (error) return <Banner text={`Couldn't reach the map API: ${error}`} />;
  if (empty) return <Banner text="The map is empty. Build it with `webnav dev record-start` → explore → `graph-edit`." />;
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button
        aria-label="toggle dark mode" aria-pressed={dark} onClick={toggleDark}
        title={dark ? 'Switch to light' : 'Switch to dark'}
        style={{ position: 'absolute', zIndex: 10, top: 12, right: 12,
          padding: '5px 10px', fontSize: 14, cursor: 'pointer', borderRadius: 8,
          border: `1px solid ${dark ? '#334155' : '#cbd5e1'}`,
          background: dark ? '#1e293b' : '#fff', color: dark ? '#fbbf24' : '#334155',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)', lineHeight: 1 }}
      >
        {dark ? '☀' : '☾'}
      </button>
      <ReactFlow nodes={themedNodes} edges={edges} nodeTypes={nodeTypes} colorMode={dark ? 'dark' : 'light'} fitView
        onNodeClick={(_, n) => onOpen(n.id)}>
        <Controls /><MiniMap />
      </ReactFlow>
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#334155' }}>{text}</div>;
}
