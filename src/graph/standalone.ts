import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IMapStore } from '../mapstore/store.js';
import { buildNodeInterior } from './interior.js';
import { buildGraphView } from './export.js';

// Produce a SINGLE self-contained HTML string that renders a site's interior
// graph offline — open it by double-clicking, no server. It inlines the built
// web bundle (JS + CSS from web/dist) and the interior + graph DATA on
// `window.__WEBNAV_DATA__`, which the viewer's api.ts reads instead of the server.
//
// Requires `web/dist` to exist (run `npm --prefix web run build` first). Returns
// the HTML; the caller writes it / prints the path.

function distDir(): string {
  // src/graph/standalone.ts → repo web/dist (works from src and from dist/).
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../web/dist', '../web/dist']) {
    const d = join(here, rel);
    if (existsSync(join(d, 'index.html'))) return d;
  }
  throw new Error('web/dist not found — run `npm --prefix web run build` first');
}

export function buildStandaloneHtml(store: IMapStore, site: string): string {
  const dir = distDir();
  const indexHtml = readFileSync(join(dir, 'index.html'), 'utf8');

  // Pull the asset paths out of the built index.html (hashed filenames).
  const jsMatch = indexHtml.match(/src="\.?\/?(assets\/[^"]+\.js)"/);
  const cssMatch = indexHtml.match(/href="\.?\/?(assets\/[^"]+\.css)"/);
  if (!jsMatch || !cssMatch) throw new Error('could not find built JS/CSS in web/dist/index.html');
  const js = readFileSync(join(dir, jsMatch[1]), 'utf8');
  const css = readFileSync(join(dir, cssMatch[1]), 'utf8');

  // The data the viewer reads offline: the inter-site graph (so "back to map"
  // works) + the chosen site's interior, and `open` so it jumps straight in.
  const data = {
    graph: buildGraphView(store),
    interiors: { [site]: buildNodeInterior(store, site) },
    open: site,
  };
  const dataScript = `window.__WEBNAV_DATA__ = ${JSON.stringify(data)};`;

  // Assemble: inline CSS, inline data BEFORE the app, inline app JS as a module.
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>webnav — ${site}</title>`,
    `<style>${css}</style>`,
    '</head><body style="margin:0">',
    '<div id="root" style="width:100vw;height:100vh"></div>',
    `<script>${dataScript}</script>`,
    `<script type="module">${js}</script>`,
    '</body></html>',
  ].join('\n');
}
