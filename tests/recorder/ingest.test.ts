import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { ingest, serveIngest, type IngestBody } from '../../src/recorder/ingest.js';
import { serializeSnapshot, type SerializableNode } from '../../src/recorder/snapshot-dom.js';
import { draftFromEffects } from '../../src/explorer/draft.js';

const page = (name: string, extra: SerializableNode[] = []): SerializableNode => ({
  role: 'RootWebArea', name,
  children: [{ role: 'button', name: 'Login' }, ...extra],
});

describe('ingest', () => {
  it('writes reconstructed ActionEffects that draftFromEffects can fold', () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const from = serializeSnapshot(page('Login'));
    const to = serializeSnapshot(page('Inventory', [{ role: 'link', name: 'Cart', url: 'https://s.test/cart' }]));
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
});
