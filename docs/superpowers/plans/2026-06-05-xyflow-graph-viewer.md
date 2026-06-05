# xyflow Graph Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace webnav's Cytoscape live viewer + static `graph --html` export with an isolated `web/` Vite + React + @xyflow/react app laid out by elkjs, served as static files by the existing read-only Node server.

**Architecture:** A new `web/` Vite+React+TS project (its own `package.json` so React/xyflow/elk never enter root deps) renders the graph as a pure client of the EXISTING JSON APIs (`/api/graph`, `/api/node/:id/interior`). `npm run build` also builds `web/` → `web/dist/`; `src/server.ts` gains a `serveStatic` helper that serves that dist at `/` (replacing `renderGraphHtml`). Server stays GET-only / read-only. Cytoscape (`src/graph/html.ts`, `graph --html`) is removed.

**Tech Stack:** Root: TypeScript (strict), Node 18+ (run via Node 24 here — `npm rebuild better-sqlite3` / `node-gyp rebuild` if native ABI errors), vitest. `web/`: Vite, React 18, @xyflow/react (React Flow v12), elkjs. The data-builders `export.ts`/`interior.ts` and the API routes are UNCHANGED.

**Spec:** `docs/superpowers/specs/2026-06-05-xyflow-graph-viewer-design.md`

---

## File structure

**New (`web/`):**
- `web/package.json` — isolated deps (react, react-dom, @xyflow/react, elkjs; dev: vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom, vitest).
- `web/vite.config.ts` — React plugin, dev proxy `/api → 127.0.0.1:7777`, `build.outDir='dist'`, `base:'./'`.
- `web/tsconfig.json` — strict; path alias `@server/*` → `../src/*` for type-only imports.
- `web/index.html`, `web/src/main.tsx` — mount.
- `web/src/types.ts` — re-exports `GraphView`/`NodeInteriorView` types from the server (drift guard).
- `web/src/api.ts` — `fetchGraph()`, `fetchInterior(id)`.
- `web/src/layout.ts` — `layoutGraph(nodes, edges, mode)` over elkjs; grid fallback. THE riskiest logic; unit-tested.
- `web/src/forkEdge.ts` — `isForkEdge(edge)` predicate (shared by layout + rendering).
- `web/src/nodes/SiteNode.tsx`, `web/src/nodes/StateNode.tsx` — custom nodes.
- `web/src/GraphView.tsx`, `web/src/InteriorView.tsx`, `web/src/App.tsx` — views + state.
- `web/src/layout.test.ts`, `web/src/forkEdge.test.ts` — vitest (node env).

**Modified (root):**
- `src/server.ts` — add `serveStatic`; `/` and non-`/api` → static; drop `renderGraphHtml` import.
- `src/cli.ts` — remove the `--html` branch in the `graph` dispatch.
- `src/cli-spec.ts` — remove the `--html` flag from the `graph` command + fix its example.
- `src/cli-help.ts` — (no change unless it references `--html`; verify).
- `package.json` — `build` builds `web/`; add `dev:web`; gitignore `web/dist`, `web/node_modules`.
- `.gitignore` — add `web/dist/`, `web/node_modules/`.

**Removed:**
- `src/graph/html.ts`, `tests/graph/html.test.ts`.
- `--html` assertions in `tests/cli-spec.test.ts`; `--html`-related lines (if any) in `tests/cli/surface.test.ts`.

---

## Task 1: Remove Cytoscape (`--html`) from the CLI — TDD

**Files:**
- Modify: `src/cli.ts`, `src/cli-spec.ts`
- Modify (tests): `tests/cli-spec.test.ts`
- Delete: `src/graph/html.ts`, `tests/graph/html.test.ts`

Do this FIRST so the server change (Task 2) isn't fighting a still-referenced `html.ts`. The `graph` JSON output stays; only the `--html` HTML export goes.

- [ ] **Step 1: Update the failing test first (remove the --html spec assertion)**

In `tests/cli-spec.test.ts`, DELETE the whole test block:

```typescript
  it('graph declares an --html flag for the interactive viewer', () => {
    const g = COMMANDS.find((c) => c.name === 'graph')!;
    const html = g.flags.find((f) => f.name === '--html')!;
    expect(html).toBeDefined();
    expect(html.takesValue).toBe(false);
    expect(html.description.length).toBeGreaterThan(0);
    expect(g.example).toContain('--html');
  });
```

- [ ] **Step 2: Run the suite to see what references --html / html.ts**

Run: `npx vitest run tests/cli-spec.test.ts tests/graph/html.test.ts`
Expected: `tests/graph/html.test.ts` still passes (html.ts present), cli-spec passes. This confirms the baseline before deletion.

- [ ] **Step 3: Remove the `--html` flag + fix example in `cli-spec.ts`**

In `src/cli-spec.ts`, the `graph` command's `flags` array currently has `--json` and `--html`. Remove the `--html` entry so flags is:

```typescript
    flags: [
      {
        name: '--json',
        takesValue: false,
        description: 'Emit JSON (it is already JSON — kept for flag consistency).',
      },
    ],
    example: 'webnav graph > map.json',
```

(Change the example from `'webnav graph --html > map.html'` to `'webnav graph > map.json'`.)

- [ ] **Step 4: Remove the `--html` branch in `cli.ts`**

In `src/cli.ts`, in the `if (args.cmd === 'graph')` block, DELETE these lines:

```typescript
    // --html emits a self-contained interactive viewer instead of JSON.
    // Detected directly off rawArgs, mirroring the --json flag detection.
    if (rawArgs.includes('--html')) {
      const { renderGraphHtml } = await import('./graph/html.js');
      console.log(renderGraphHtml(view));
      return;
    }
```

so the block ends with the existing `console.log(JSON.stringify(view, null, 2)); return;`.

- [ ] **Step 5: Delete the Cytoscape files**

Run:
```bash
git rm src/graph/html.ts tests/graph/html.test.ts
```

- [ ] **Step 6: Check for stragglers**

Run: `grep -rn "renderGraphHtml\|graph/html\|--html\|cytoscape" src tests`
Expected: only hit is `src/server.ts` (its `renderGraphHtml` import — fixed in Task 2). If `tests/cli/surface.test.ts` references `--html`, remove those lines now. If `cli-help.ts` references `--html`, remove it. There should be NO other references.

- [ ] **Step 7: Run tests + build**

Run: `npx vitest run` — Expected: all pass EXCEPT possibly `tests/server.test.ts` if it imports html (it doesn't; server still compiles because `renderGraphHtml` import is removed in Task 2 — but cli/spec tests pass now). If the SERVER file fails to compile here because `renderGraphHtml` is still imported but html.ts is deleted, that's expected — proceed to Task 2 which fixes server.ts. To keep this task green in isolation, ALSO do Task 2 Step 3's import removal now is NOT allowed (separate task); instead, run only the CLI tests:

Run: `npx vitest run tests/cli-spec.test.ts tests/cli.test.ts tests/cli/surface.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(cli): remove Cytoscape graph --html export (xyflow viewer replaces it)"
```

Note: `src/server.ts` still imports `renderGraphHtml` and will not compile until Task 2. Do Task 2 next before any full build.

---

## Task 2: Server `serveStatic` — TDD

**Files:**
- Modify: `src/server.ts`
- Test: `tests/server-static.test.ts`

Add a static-file server for `web/dist/`, with a path-traversal guard and a "run npm run build" hint when dist is absent. Replace the `renderGraphHtml` call at `/`. Server stays GET-only/read-only. The existing `startServer(store, port)` signature is unchanged; add an optional `distDir` param (default resolves to `web/dist` relative to the built server file) so tests can point it at a fixture dir.

- [ ] **Step 1: Write the failing test**

Create `tests/server-static.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MapStore } from '../src/mapstore/store.js';
import { startServer } from '../src/server.js';
import type { Server } from 'node:http';

const store = MapStore.fromDatabase(new Database(':memory:'));
let dist: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'webdist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>webnav</title>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("hi")');
  server = startServer(store, 0, dist);          // port 0 = ephemeral
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => { server.close(); rmSync(dist, { recursive: true, force: true }); });

describe('serveStatic', () => {
  it('serves index.html at /', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('webnav');
  });
  it('serves an asset with a js content-type', async () => {
    const r = await fetch(`${base}/assets/app.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
  });
  it('blocks path traversal', async () => {
    const r = await fetch(`${base}/../../etc/passwd`);
    expect([400, 403, 404]).toContain(r.status);
  });
  it('still serves the JSON API', async () => {
    const r = await fetch(`${base}/api/graph`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
  });
  it('falls back to index.html for an unknown non-api path (SPA)', async () => {
    const r = await fetch(`${base}/some/client/route`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('webnav');
  });
});

describe('serveStatic — missing dist', () => {
  it('returns a build hint when dist is absent', async () => {
    const missing = join(tmpdir(), 'definitely-not-built-xyz');
    const s2 = startServer(store, 0, missing);
    await new Promise((r) => s2.once('listening', r));
    const addr = s2.address();
    const b2 = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const r = await fetch(`${b2}/`);
    expect(r.status).toBe(503);
    expect(await r.text()).toMatch(/npm run build/);
    s2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server-static.test.ts`
Expected: FAIL — `startServer` doesn't accept a 3rd arg / still calls `renderGraphHtml` (and html.ts is gone, so it won't even compile).

- [ ] **Step 3: Rewrite `src/server.ts`**

Replace `src/server.ts` with:

```typescript
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { IMapStore } from './mapstore/store.js';
import { buildGraphView } from './graph/export.js';
import { buildNodeInterior } from './graph/interior.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Default dist dir: ../../web/dist relative to the BUILT server file (dist/server.js).
const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

/**
 * A read-only HTTP server over the live map. webnav's only long-lived process —
 * deliberately dumb: it reads SQLite + serves the static viewer; it never writes
 * and holds no navigation logic. Bind 127.0.0.1 (single user, no auth/CORS).
 */
export function startServer(store: IMapStore, port = 7777, distDir: string = DEFAULT_DIST): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type }); res.end(body);
    };
    try {
      if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'method not allowed' }));

      // ── API (unchanged, read-only) ──
      if (url.pathname === '/api/graph') {
        return send(200, JSON.stringify(buildGraphView(store)));
      }
      const m = url.pathname.match(/^\/api\/node\/([^/]+)\/interior$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!store.getNode(id)) return send(404, JSON.stringify({ error: 'unknown node' }));
        return send(200, JSON.stringify(buildNodeInterior(store, id)));
      }

      // ── Static viewer (web/dist) ──
      return serveStatic(url.pathname, distDir, send);
    } catch (e) {
      send(500, JSON.stringify({ error: String(e) }));
    }
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    const hint = err.code === 'EADDRINUSE'
      ? `port ${port} is already in use — set WEBNAV_PORT to a free port`
      : err.message;
    process.stderr.write(`webnav server: ${hint}\n`);
    process.exitCode = 2;
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/** Serve a file from distDir; SPA-fallback to index.html; guard traversal. */
function serveStatic(
  pathname: string, distDir: string,
  send: (code: number, body: string, type?: string) => void,
): void {
  if (!existsSync(distDir)) {
    return send(503, 'webnav viewer not built — run `npm run build` first.', 'text/plain; charset=utf-8');
  }
  // Resolve the requested path INSIDE distDir; reject anything that escapes.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(distDir, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (!filePath.startsWith(resolve(distDir))) {
    return send(403, 'forbidden', 'text/plain; charset=utf-8');
  }
  // Directory or missing file → SPA fallback to index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }
  if (!existsSync(filePath)) return send(404, 'not found', 'text/plain; charset=utf-8');
  const body = readFileSync(filePath);
  const type = MIME[extname(filePath)] ?? 'application/octet-stream';
  // send() takes a string; read as utf8 for text types, base64-safe binary otherwise.
  // For v1 the assets are text (html/js/css/svg); read as utf8.
  send(200, body.toString('utf8'), type);
}
```

NOTE on binary assets: v1 viewer assets are text (html/js/css/svg/json). If a binary (png/ico/woff) is requested and mangled by utf8, that's acceptable for v1 (the app doesn't ship binaries); a follow-up can switch `send` to accept a Buffer. Keep the MIME map though.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server-static.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run` — Expected: all pass (server now compiles; html.ts gone).
Run: `npm run build` — Expected: tsc succeeds (note: `npm run build` will be updated in Task 7 to also build web; for now plain tsc must pass).

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/server-static.test.ts
git commit -m "feat(server): serveStatic for web/dist + traversal guard (replaces renderGraphHtml)"
```

---

## Task 3: Scaffold the `web/` Vite + React + xyflow app

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx` (stub), `web/.gitignore`
- Modify: root `.gitignore`

No unit test here (scaffold); verified by `web` building. Keep `App.tsx` a trivial stub for now (real views in Tasks 5–6).

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "webnav-viewer",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@xyflow/react": "^12.3.0",
    "elkjs": "^0.9.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:7777' },
  },
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "paths": { "@server/*": ["../src/*"] },
    "baseUrl": "."
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>webnav — map</title>
  </head>
  <body style="margin:0">
    <div id="root" style="width:100vw;height:100vh"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Create `web/src/App.tsx` (stub)**

```tsx
export function App() {
  return <div style={{ padding: 16, fontFamily: 'sans-serif' }}>webnav viewer — loading…</div>;
}
```

- [ ] **Step 7: Create `web/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 8: Update root `.gitignore`**

Append to the root `.gitignore`:
```
web/node_modules/
web/dist/
```

- [ ] **Step 9: Install + build web to verify the scaffold**

Run:
```bash
cd web && npm install && npm run build && cd ..
```
Expected: `web/dist/index.html` + `web/dist/assets/*.js` produced, no errors. (If install is slow/offline, report BLOCKED — the deps must resolve.)

- [ ] **Step 10: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/src/main.tsx web/src/App.tsx web/.gitignore .gitignore
git commit -m "feat(web): scaffold Vite + React + xyflow viewer app"
```

(Do NOT commit `web/package-lock.json` unless the project commits lockfiles — check; the root has none committed for web. If npm created `web/package-lock.json`, add it too for reproducibility.)

---

## Task 4: `forkEdge` predicate + `layout.ts` (elk mapping) — TDD

**Files:**
- Create: `web/src/forkEdge.ts`, `web/src/layout.ts`, `web/src/types.ts`
- Test: `web/src/forkEdge.test.ts`, `web/src/layout.test.ts`

The layout module is the riskiest logic → unit-tested. `types.ts` re-exports the server contract.

- [ ] **Step 1: Create `web/src/types.ts`**

```typescript
// The viewer's contract with the server. Type-only imports via the @server alias
// so the API can't drift silently (tsc fails if these change shape).
export type { GraphView } from '@server/graph/export.js';
export type { NodeInteriorView } from '@server/graph/interior.js';
```

- [ ] **Step 2: Write `forkEdge.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { isForkEdge } from './forkEdge.js';

describe('isForkEdge', () => {
  it('flags an unclassified edge', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'click Sign in', kind: 'unclassified' })).toBe(true);
  });
  it('flags a needs-input step regardless of kind', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'do x [needs-input: creds]', kind: 'navigate' })).toBe(true);
  });
  it('does not flag a plain navigate edge', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'follow a result link', kind: 'navigate' })).toBe(false);
  });
});
```

- [ ] **Step 3: Create `web/src/forkEdge.ts`**

```typescript
import type { NodeInteriorView } from './types.js';

type InteriorEdge = NodeInteriorView['edges'][number];

/** A fork edge is one the map cannot auto-traverse: it needs a human/agent
 *  decision (login/pay/etc). Marked at graph-edit time as kind 'unclassified'
 *  and/or a '[needs-input: ...]' suffix on the step. */
export function isForkEdge(edge: InteriorEdge): boolean {
  return edge.kind === 'unclassified' || edge.semanticStep.includes('[needs-input:');
}
```

- [ ] **Step 4: Run forkEdge test**

Run: `cd web && npx vitest run src/forkEdge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `layout.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout.js';

describe('layoutGraph', () => {
  it('positions every interior node and preserves every edge', async () => {
    const nodes = [
      { id: 'gh:search', label: 'search' },
      { id: 'gh:detail', label: 'detail' },
    ];
    const edges = [{ id: 'e1', source: 'gh:search', target: 'gh:detail', fork: false }];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
    }
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].source).toBe('gh:search');
  });

  it('handles a cyclic edge without throwing', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false },
      { id: 'e2', source: 'b', target: 'a', fork: true },
    ];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(2);
  });

  it('falls back to a grid if a node is malformed (no throw, all positioned)', async () => {
    // duplicate ids would make elk throw; layoutGraph must still return positions.
    const nodes = [{ id: 'x', label: 'x' }, { id: 'x', label: 'x-dup' }];
    const edges: { id: string; source: string; target: string; fork: boolean }[] = [];
    const out = await layoutGraph(nodes, edges, 'interior');
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) expect(typeof n.position.x).toBe('number');
  });
});
```

- [ ] **Step 6: Create `web/src/layout.ts`**

```typescript
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

export interface LayoutNode { id: string; label: string; parent?: string; }
export interface LayoutEdge { id: string; source: string; target: string; fork: boolean; }
export type LayoutMode = 'clusters' | 'interior';

const elk = new ELK();
const NODE_W = 180, NODE_H = 56;

/**
 * Lay out nodes/edges with ELK. `interior` = layered (top-down state machine);
 * `clusters` = layered with more spacing (the capability neighborhoods).
 * Pure mapping: our shapes → ELK graph → positioned xyflow nodes/edges.
 * On ANY elk failure, fall back to a deterministic grid so render never dies.
 */
export async function layoutGraph(
  nodes: LayoutNode[], edges: LayoutEdge[], mode: LayoutMode,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': mode === 'clusters' ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': mode === 'clusters' ? '60' : '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    // If elk dropped/merged any node (e.g. duplicate id), fill the gaps via grid.
    if (Object.keys(positions).length < nodes.length) positions = gridPositions(nodes);
  } catch {
    positions = gridPositions(nodes);
  }

  const rfNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label },
    type: mode === 'clusters' ? 'site' : 'state',
  }));
  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    data: { fork: e.fork },
    animated: e.fork,
    style: e.fork ? { strokeDasharray: '6 4', stroke: '#c2410c' } : undefined,
  }));
  return { nodes: rfNodes, edges: rfEdges };
}

function gridPositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(Math.max(1, nodes.length)));
  nodes.forEach((n, i) => {
    out[n.id] = { x: (i % cols) * (NODE_W + 40), y: Math.floor(i / cols) * (NODE_H + 40) };
  });
  return out;
}
```

NOTE: `elk.bundled.js` runs in-thread (no separate worker file needed for v1; simpler and the graphs are small). The grid-fallback covers both throws and elk dropping duplicate-id nodes (the third test).

- [ ] **Step 7: Run layout test**

Run: `cd web && npx vitest run src/layout.test.ts`
Expected: PASS (3 tests). (elkjs runs headless in node.)

- [ ] **Step 8: Commit**

```bash
cd .. && git add web/src/types.ts web/src/forkEdge.ts web/src/forkEdge.test.ts web/src/layout.ts web/src/layout.test.ts
git commit -m "feat(web): elkjs layout mapping + fork-edge predicate (unit-tested)"
```

---

## Task 5: API client + custom nodes + GraphView/InteriorView/App

**Files:**
- Create: `web/src/api.ts`, `web/src/nodes/SiteNode.tsx`, `web/src/nodes/StateNode.tsx`, `web/src/GraphView.tsx`, `web/src/InteriorView.tsx`
- Modify: `web/src/App.tsx`

No unit tests (visual components); verified by build + the live render in Task 6.

- [ ] **Step 1: Create `web/src/api.ts`**

```typescript
import type { GraphView, NodeInteriorView } from './types.js';

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
export const fetchGraph = () => getJson<GraphView>('/api/graph');
export const fetchInterior = (id: string) =>
  getJson<NodeInteriorView>(`/api/node/${encodeURIComponent(id)}/interior`);
```

- [ ] **Step 2: Create `web/src/nodes/SiteNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

export function SiteNode({ data }: NodeProps) {
  const d = data as { label: string; capabilities?: string[] };
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 8, background: '#fff',
      padding: '8px 12px', minWidth: 160, fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.capabilities?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {d.capabilities.map((c) => (
            <span key={c} style={{ fontSize: 10, background: '#e2e8f0', borderRadius: 4, padding: '1px 5px' }}>{c}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/nodes/StateNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StateNode({ data }: NodeProps) {
  const d = data as { label: string; role?: string; signals?: string[] };
  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      padding: '8px 12px', minWidth: 150, fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.role ? <div style={{ fontSize: 10, color: '#64748b' }}>{d.role}</div> : null}
      {d.signals?.length ? (
        <div style={{ fontSize: 10, color: '#0f766e' }}>{d.signals.join(', ')}</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 4: Create `web/src/GraphView.tsx`**

```tsx
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
      // attach capabilities to node data for the SiteNode card
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
```

- [ ] **Step 5: Create `web/src/InteriorView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph } from './layout.js';
import { isForkEdge } from './forkEdge.js';
import { StateNode } from './nodes/StateNode.js';

const nodeTypes = { state: StateNode };

export function InteriorView({ id, onBack }: { id: string; onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }
      const ln = iv.states.map((s) => ({ id: s.id, label: s.semanticName }));
      const le = iv.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, fork: isForkEdge(e) }));
      const laid = await layoutGraph(ln, le, 'interior');
      const meta = new Map(iv.states.map((s) => [s.id, s]));
      setNodes(laid.nodes.map((nd) => {
        const s = meta.get(nd.id);
        return { ...nd, data: { ...nd.data, role: s?.role, signals: s?.availableSignals } };
      }));
      setEdges(laid.edges);
    }).catch((e) => {
      // 404 (unknown/empty interior) lands here too via the !ok throw.
      setEmpty(true); setError(String(e));
    });
  }, [id]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button onClick={onBack} style={{ position: 'absolute', zIndex: 10, top: 12, left: 12,
        padding: '6px 10px', fontFamily: 'sans-serif', cursor: 'pointer' }}>← back to map</button>
      {empty
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif' }}>No interior recorded for <b>{id}</b> yet. Map it with a record session.</div>
        : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
            <Background /><Controls /><MiniMap />
          </ReactFlow>}
    </div>
  );
}
```

- [ ] **Step 6: Replace `web/src/App.tsx`**

```tsx
import { useState } from 'react';
import { GraphView } from './GraphView.js';
import { InteriorView } from './InteriorView.js';

export function App() {
  const [open, setOpen] = useState<string | null>(null);
  return open
    ? <InteriorView id={open} onBack={() => setOpen(null)} />
    : <GraphView onOpen={setOpen} />;
}
```

- [ ] **Step 7: Build web to verify it compiles**

Run: `cd web && npm run build && cd ..`
Expected: `tsc -b` passes (types resolve through `@server/*`), `vite build` produces `web/dist/`. If `@server/*` type imports fail under `vite build`, confirm they are `import type` only (they are, via types.ts) so Vite strips them.

- [ ] **Step 8: Commit**

```bash
git add web/src/api.ts web/src/nodes/ web/src/GraphView.tsx web/src/InteriorView.tsx web/src/App.tsx
git commit -m "feat(web): API client, custom nodes, GraphView + InteriorView + drill-in"
```

---

## Task 6: Wire root build + live-render acceptance

**Files:**
- Modify: root `package.json`

- [ ] **Step 1: Update root `package.json` scripts**

Change `build` and add `dev:web`:

```json
  "scripts": {
    "build": "tsc && cp src/mapstore/schema.sql dist/mapstore/ && npm --prefix web install && npm --prefix web run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/dev.ts",
    "dev:web": "npm --prefix web run dev",
    "webnav": "tsx src/cli.ts"
  }
```

(The `npm --prefix web install` makes a clean checkout build without a manual web install. If install-on-every-build is too slow, a follow-up can gate it; for v1 correctness over speed.)

- [ ] **Step 2: Full root build**

Run: `npm run build`
Expected: tsc builds `dist/`, schema copied, web installs + builds `web/dist/`. (Native ABI error → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`, re-run.)

- [ ] **Step 3: Live-render acceptance (headless playwright-cli)**

Start the built server against a seeded DB and drive it headless. Run:

```bash
# build a temp DB with a known interior so drill-in has something to show
TMPD=$(mktemp -d)
WEBNAV_DB="$TMPD/webnav.db" node dist/dev.js &   # seeds + serves on 7777
sleep 2
playwright-cli -s=viewer goto http://127.0.0.1:7777
playwright-cli -s=viewer snapshot          # expect: a graph canvas, site nodes (github.com etc.)
playwright-cli -s=viewer eval "() => document.querySelectorAll('.react-flow__node').length"  # > 0
# click a site node to drill in:
playwright-cli -s=viewer eval "() => { const n=[...document.querySelectorAll('.react-flow__node')].find(e=>/github/i.test(e.textContent||'')); n && n.click(); return !!n; }"
sleep 1
playwright-cli -s=viewer snapshot          # expect: interior states + a 'back to map' button
playwright-cli -s=viewer eval "() => document.body.innerText.includes('back to map')"  # true
playwright-cli -s=viewer screenshot /tmp/webnav-viewer.png
playwright-cli -s=viewer close
kill %1 2>/dev/null; rm -rf "$TMPD"
```

Expected: `.react-flow__node` count > 0 on the cluster view; after clicking a site, the interior renders and the "back to map" control is present. Inspect `/tmp/webnav-viewer.png`. If a node has a fork edge, confirm a dashed/orange edge is present. If the render is blank, debug before claiming done (check the browser console via `playwright-cli ... console`).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: root build also builds web/; dev:web script; live-render verified"
```

---

## Task 7: Update docs (README + STATUS)

**Files:**
- Modify: `README.md`, `docs/STATUS.md`

- [ ] **Step 1: README — update the viewer line**

In `README.md`, replace any `webnav graph --html` / Cytoscape mention with: the live viewer is `npm run dev` → http://127.0.0.1:7777 (xyflow + elkjs); for the React app dev server with HMR use `npm run dev:web` (proxies `/api` to the Node server). `webnav dev graph` still emits the graph as JSON.

- [ ] **Step 2: STATUS — note the swap**

In `docs/STATUS.md`, update the graph-viz notes: the live viewer is now an `web/` Vite+React+@xyflow/react app (elkjs layout), served as static `web/dist/` by the read-only Node server; the Cytoscape `graph --html` export was removed. Add:

```markdown
### Graph viewer — xyflow (DONE, 2026-06-05)

The live graph viewer is now a `web/` Vite + React + **@xyflow/react** app laid
out by **elkjs**, served as static `web/dist/` by the existing read-only Node
server (`npm run dev` → http://127.0.0.1:7777; `npm run dev:web` for HMR). Clusters
→ click a site → drill into its interior skeleton; fork (`needs-input`) edges are
dashed/orange. The Cytoscape viewer + `graph --html` export were removed. Server
stays read-only (live editing is a future increment). `web/` is an isolated
package — React/xyflow/elk are NOT root deps. Spec/plan:
`docs/superpowers/specs/2026-06-05-xyflow-graph-viewer-design.md`,
`docs/superpowers/plans/2026-06-05-xyflow-graph-viewer.md`.
```

Update the verb table: `webnav dev graph` no longer lists `--html`.

- [ ] **Step 3: Full suite + build green**

Run: `npx vitest run` — Expected: all pass, gated e2e skipped.
Run: `npm run build` — Expected: succeeds incl. web build.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/STATUS.md
git commit -m "docs: xyflow graph viewer done (Cytoscape + graph --html removed)"
```

---

## Self-review notes (for the implementer)

- **Order matters:** Task 1 (remove html.ts) leaves `src/server.ts` temporarily non-compiling (it still imports `renderGraphHtml`); Task 2 fixes it. Do them back-to-back; don't run a full `npm run build` between them.
- **Read-only invariant:** the server gains ONLY `serveStatic` (GET, reads files). No write endpoints. Don't add any.
- **`web/` isolation:** React/xyflow/elk live in `web/package.json`. Never add them to the root `package.json`.
- **Type drift guard:** `web/src/types.ts` re-exports the server's `GraphView`/`NodeInteriorView` as `import type` via the `@server/*` alias. These MUST be type-only (Vite can't bundle server runtime code). If a value import sneaks in, the web build breaks — keep it types-only.
- **elk in-thread:** v1 uses `elkjs/lib/elk.bundled.js` (no web worker) — graphs are small; simpler. Worker is a future optimization.
- **Binary assets:** `serveStatic` reads files as utf8 (v1 ships only text assets). A Buffer-aware `send` is a noted follow-up if binaries are added.
- **Native module:** if vitest/build mass-fails with `NODE_MODULE_VERSION`, run `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
- **Live render is the acceptance gate** (Task 6 Step 3) — components aren't unit-tested; a blank render is a failure to debug, not to wave through.
