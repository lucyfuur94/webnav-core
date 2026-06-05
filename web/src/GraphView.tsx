import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchGraph } from './api.js';
import { layoutGraph } from './layout.js';
import { SiteNode } from './nodes/SiteNode.js';

const nodeTypes = { site: SiteNode };

export function GraphView({ onOpen }: { onOpen: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetchGraph().then(async (g) => {
      if (!g.nodes.length) { setEmpty(true); return; }
      const ln = g.nodes.map((n) => ({ id: n.id, label: n.id }));
      const le = g.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, fork: false }));
      const laid = await layoutGraph(ln, le, 'clusters');
      const capById = new Map(g.nodes.map((n) => [n.id, n.capabilities]));
      setNodes(laid.nodes.map((nd) => ({ ...nd, data: { ...nd.data, capabilities: capById.get(nd.id) } })));
      setEdges(laid.edges);
    }).catch((e) => setError(String(e)));
  }, []);

  if (error) return <Banner text={`Couldn't reach the map API: ${error}`} />;
  if (empty) return <Banner text="The map is empty. Build it with `webnav dev record-start` → explore → `graph-edit`." />;
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView
        onNodeClick={(_, n) => onOpen(n.id)}>
        <Background /><Controls /><MiniMap />
      </ReactFlow>
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#334155' }}>{text}</div>;
}
