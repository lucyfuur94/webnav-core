import { useState } from 'react';
import { GraphView } from './GraphView.js';
import { InteriorView } from './InteriorView.js';

export function App() {
  const [open, setOpen] = useState<string | null>(null);
  return open
    ? <InteriorView id={open} onBack={() => setOpen(null)} />
    : <GraphView onOpen={setOpen} />;
}
