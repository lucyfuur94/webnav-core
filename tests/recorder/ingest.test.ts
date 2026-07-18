import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import {
  ingest, ingestAX, serveIngest, reconstructEffectFromNodes,
  type IngestBody, type IngestAXBody,
} from '../../src/recorder/ingest.js';
import { serializeSnapshot, type SerializableNode } from '../../src/recorder/snapshot-dom.js';
import { adaptAXTree, type AXNode } from '../../src/playwright/ax-adapter.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { draftFromEffects } from '../../src/explorer/draft.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/ax');
const axFixture = (name: string): AXNode[] => JSON.parse(readFileSync(join(fixturesDir, `${name}.ax.json`), 'utf8'));

const page = (name: string, extra: SerializableNode[] = []): SerializableNode => ({
  role: 'RootWebArea', name,
  children: [{ role: 'button', name: 'Login' }, ...extra],
});

describe('ingest', () => {
  it('writes reconstructed ActionEffects that draftFromEffects can fold', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    // pad each landing to ≥8 named nodes so classifyReadiness='ready' (draft's identity gate).
    const pad = (prefix: string): SerializableNode[] => [
      { role: 'heading', name: `${prefix} heading` }, { role: 'paragraph', name: `${prefix} intro` },
      { role: 'listitem', name: `${prefix} item 1` }, { role: 'listitem', name: `${prefix} item 2` },
      { role: 'button', name: `${prefix} action` }, { role: 'paragraph', name: `${prefix} footer` },
    ];
    const from = serializeSnapshot(page('Login', pad('Login')));
    const to = serializeSnapshot(page('Inventory', [{ role: 'link', name: 'Cart', url: 'https://s.test/cart' }, ...pad('Inventory')]));
    const body: IngestBody = {
      sessionId: 'human-1',
      steps: [{
        fromUrl: 'https://s.test/login', fromSnapshot: from,
        toUrl: 'https://s.test/inventory', toSnapshot: to,
        navigated: true,
        ref: 'e2', // the "Login" button in the from-snapshot (e1=root, e2=button)
      }],
    };
    const n = ingest(body, store);
    expect(n).toBe(1);

    const effects = store.actionEffects('human-1');
    expect(effects.length).toBe(1);
    // server-side reconstruction filled the fingerprint from the synthetic ref
    expect(effects[0].action?.elementFp?.role).toBe('button');
    expect(effects[0].action?.elementFp?.name).toBe('Login');
    // server-side diff is present (not the empty placeholder)
    expect(effects[0].diff).toBeTruthy();

    // the whole point: human sessions are walkable like agent sessions
    const draft = draftFromEffects(effects);
    expect(draft.states.length).toBeGreaterThan(0);
  });

  it('a pure navigation step (ref=null) still ingests', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestBody = {
      sessionId: 'human-2',
      steps: [{
        fromUrl: 'https://s.test/a', fromSnapshot: serializeSnapshot(page('A')),
        toUrl: 'https://s.test/b', toSnapshot: serializeSnapshot(page('B')),
        navigated: true, ref: null,
      }],
    };
    expect(ingest(body, store)).toBe(1);
    expect(store.actionEffects('human-2')[0].action).toBeNull();
  });

  it('recomputes navigated server-side (ignores the extension flag; host+path, not query/hash)', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    ingest({
      sessionId: 'nav-1',
      steps: [
        // same host+path, only query differs → NOT a navigation, even though extension says true
        { fromUrl: 'https://s.test/x?a=1', fromSnapshot: serializeSnapshot(page('X')),
          toUrl: 'https://s.test/x?a=2', toSnapshot: serializeSnapshot(page('X')),
          navigated: true, ref: 'e2' },
        // different path → IS a navigation, even though extension says false
        { fromUrl: 'https://s.test/x', fromSnapshot: serializeSnapshot(page('X')),
          toUrl: 'https://s.test/y', toSnapshot: serializeSnapshot(page('Y')),
          navigated: false, ref: 'e2' },
      ],
    }, store);
    const fx = store.actionEffects('nav-1');
    expect(fx[0].navigated).toBe(false);  // query-only change → same page
    expect(fx[1].navigated).toBe(true);   // path change → navigation
  });

  it('re-ingesting the same session replaces, does not duplicate', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestBody = {
      sessionId: 'dup-1',
      steps: [{ fromUrl: 'https://s.test/a', fromSnapshot: serializeSnapshot(page('A')),
        toUrl: 'https://s.test/b', toSnapshot: serializeSnapshot(page('B')), ref: 'e2' }],
    };
    ingest(body, store);
    ingest(body, store);  // same session id again
    expect(store.actionEffects('dup-1').length).toBe(1);  // replaced, not 2
  });

  it('serveIngest accepts a POST and appends', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const server = serveIngest(0, store); // port 0 = OS-assigned
    await new Promise((r) => server.on('listening', r));
    const port = (server.address() as any).port;
    const body: IngestBody = {
      sessionId: 'http-1',
      steps: [{
        fromUrl: 'https://s.test/a', fromSnapshot: serializeSnapshot(page('A')),
        toUrl: 'https://s.test/b', toSnapshot: serializeSnapshot(page('B')),
        navigated: true, ref: 'e2',
      }],
    };
    const res = await fetch(`http://127.0.0.1:${port}/ingest`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json() as any;
    server.close();
    expect(json.ok).toBe(true);
    expect(json.appended).toBe(1);
    expect(store.actionEffects('http-1').length).toBe(1);
  });

  it('reconstructEffectFromNodes is the shared core: DOM-walk reconstructEffect matches it byte-for-byte on the parsed nodes', () => {
    const from = serializeSnapshot(page('Login'));
    const to = serializeSnapshot(page('Inventory', [{ role: 'link', name: 'Cart', url: 'https://s.test/cart' }]));
    const viaCore = reconstructEffectFromNodes(
      parseSnapshot(from), parseSnapshot(to), 'https://s.test/login', 'https://s.test/inventory', 'e2',
    );
    expect(viaCore.action?.role).toBe('button');
    expect(viaCore.action?.name).toBe('Login');
    expect(viaCore.navigated).toBe(true);
    expect(viaCore.diff.added.some((n) => n.name === 'Cart')).toBe(true);
  });

  it('ingestAX adapts raw AX trees and reconstructs effects identically to the DOM-walk path', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestAXBody = {
      sessionId: 'ax-1',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
        clickedRef: 'b7',  // the "Settings" button in adaptAXTree(icons) — see icons.expected.a.yaml
      }],
    };
    expect(ingestAX(body, store)).toBe(1);

    const effects = store.actionEffects('ax-1');
    expect(effects.length).toBe(1);
    const fx = effects[0];
    // fingerprint recovered from the adapted AX node (role+name), same as the DOM-walk path
    expect(fx.action?.role).toBe('button');
    expect(fx.action?.name).toBe('Settings');
    expect(fx.action?.elementFp?.role).toBe('button');
    expect(fx.action?.elementFp?.name).toBe('Settings');
    // navigated recomputed via didNavigate (host+path), not trusted from the extension
    expect(fx.navigated).toBe(true);
    // stored snapshots round-trip through parseSnapshot into the same structure adaptAXTree produced
    expect(parseSnapshot(fx.fromSnapshot).map((n) => [n.role, n.name]))
      .toEqual(adaptAXTree(axFixture('icons')).map((n) => [n.role, n.name]));
    expect(parseSnapshot(fx.toSnapshot).map((n) => [n.role, n.name]))
      .toEqual(adaptAXTree(axFixture('table')).map((n) => [n.role, n.name]));
    // diff surfaces the table's new nodes
    expect(fx.diff.added.some((n) => n.role === 'table')).toBe(true);
  });

  it('ingestAX: a pure navigation step (clickedRef omitted) still ingests with action:null', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestAXBody = {
      sessionId: 'ax-2',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
      }],
    };
    expect(ingestAX(body, store)).toBe(1);
    expect(store.actionEffects('ax-2')[0].action).toBeNull();
  });

  it('ingestAX re-ingesting the same session replaces, does not duplicate', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const body: IngestAXBody = {
      sessionId: 'ax-dup',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
        clickedRef: 'b7',
      }],
    };
    ingestAX(body, store);
    ingestAX(body, store);
    expect(store.actionEffects('ax-dup').length).toBe(1);
  });

  it('serveIngest routes POST /ingest-ax to ingestAX', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const server = serveIngest(0, store);
    await new Promise((r) => server.on('listening', r));
    const port = (server.address() as any).port;
    const body: IngestAXBody = {
      sessionId: 'ax-http-1',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
        clickedRef: 'b7',
      }],
    };
    const res = await fetch(`http://127.0.0.1:${port}/ingest-ax`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json() as any;
    server.close();
    expect(json.ok).toBe(true);
    expect(json.appended).toBe(1);
    expect(store.actionEffects('ax-http-1').length).toBe(1);
  });

  it('row-fold verification: AX-sourced table effects fold per-row data VALUES out of the draft (producer-agnostic no-values rule)', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    // A landing step onto the 3-row table (Acme/Globex/Initech owners Dana/Ravi/Mei).
    // fromAX = icons (a distinct prior page) so the table lands via navigation.
    ingestAX({
      sessionId: 'ax-rowfold',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
        clickedRef: 'b7',
      }],
    }, store);

    const draft = draftFromEffects(store.actionEffects('ax-rowfold'));
    const allText = JSON.stringify(draft);
    // the row-fold VALUES (per-row data) must never appear as affordance/state names —
    // only the folded row TEMPLATE (scope:'row') may appear.
    for (const value of ['Acme Corp', 'Globex', 'Initech', 'Dana', 'Ravi', 'Mei']) {
      expect(allText.includes(value)).toBe(false);
    }
  });
});
