import { MapStore } from './mapstore/store.js';
import { ensureSeeded } from './graph/seed.js';
import { startServer } from './server.js';

const port = Number(process.env.WEBNAV_PORT ?? 7777);
const store = new MapStore(process.env.WEBNAV_DB ?? 'webnav.db');
// Ensure nodes AND interiors are seeded (guards on an interior state, so a
// pre-existing node-only DB still gets its interiors — DB is source of truth).
ensureSeeded(store);
startServer(store, port);
console.log(`webnav graph viewer → http://127.0.0.1:${port}`);
