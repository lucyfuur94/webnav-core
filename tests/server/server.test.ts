import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { startServer } from '../../src/server.js';

let server: Server;
afterEach(() => server?.close());

async function boot(distDir?: string) {
  const store = new MapStore(':memory:');
  seedGraph(store);
  server = startServer(store, 0, distDir); // port 0 = ephemeral
  await new Promise<void>((r) => server.on('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe('webnav dev server', () => {
  it('GET / serves the build hint when web/dist is absent', async () => {
    // The viewer is the web/ Vite+React app served from web/dist; point the
    // server at a guaranteed-absent dist so this is deterministic whether or not
    // web has been built. The served-static happy path lives in
    // tests/server-static.test.ts.
    const base = await boot('/tmp/webnav-dist-does-not-exist-xyz');
    const res = await fetch(base + '/');
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/npm run build/);
  });

  it('GET /api/graph returns the graph view JSON', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/graph');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.map((n: any) => n.id)).toContain('github.com');
  });

  it('GET /api/node/github.com/interior returns its interior', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/github.com/interior');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.states.map((s: any) => s.id)).toContain('github:repo-detail');
  });

  it('GET interior of a node with no skeleton is empty', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/pypi.org/interior');
    expect(res.status).toBe(200);
    expect((await res.json()).states).toEqual([]);
  });

  it('GET interior of an unknown node is 404', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/nope.example/interior');
    expect(res.status).toBe(404);
  });
});
