import { useState } from 'react';
import { GraphView } from './GraphView.js';
import { InteriorView } from './InteriorView.js';
import { standaloneOpen } from './api.js';

export function App() {
  // In a standalone export, jump straight into the bundled site's interior.
  const [open, setOpen] = useState<string | null>(() => standaloneOpen());
  return open
    ? <InteriorView id={open} onBack={() => setOpen(null)} />
    : <GraphView onOpen={setOpen} />;
}
