import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchHostedMap, importMapPack, saveConfig, readConfig, resolveApiBase, resolveApiKey, type FetchFn, type MapPack } from '../src/hosted.js';
import { MapStore } from '../src/mapstore/store.js';
import { makeState } from '../src/mapstore/types.js';

const CFG = join(tmpdir(), `webnav-config-test-${process.pid}.json`);

// A map pack the way the API returns it: skeleton ONLY, no credentials.
const PACK: MapPack = {
  node: { id: 'example.com', homeUrl: 'https://example.com', capabilities: [], topics: [] },
  states: [
    makeState({ id: 'example.com:a', nodeId: 'example.com', semanticName: 'a', urlPattern: '', role: 'detail', fingerprint: ['x'] }),
    makeState({ id: 'example.com:b', nodeId: 'example.com', semanticName: 'b', urlPattern: '', role: 'detail', fingerprint: ['y'] }),
  ],
};

function fakeFetch(status: number, body: unknown): FetchFn {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('hosted route', () => {
  beforeEach(() => { process.env.WEBNAV_CONFIG = CFG; delete process.env.WEBNAV_KEY; delete process.env.WEBNAV_API; if (existsSync(CFG)) rmSync(CFG); });
  afterEach(() => { if (existsSync(CFG)) rmSync(CFG); delete process.env.WEBNAV_CONFIG; });

  it('saveConfig/readConfig round-trips the key (and writes 0600)', () => {
    saveConfig({ apiKey: 'wn_test' });
    expect(readConfig().apiKey).toBe('wn_test');
    // never stores credentials — only the key/base
    expect(Object.keys(JSON.parse(readFileSync(CFG, 'utf8')))).toEqual(['apiKey']);
  });

  it('resolveApiKey: explicit > env > config', () => {
    saveConfig({ apiKey: 'from_config' });
    expect(resolveApiKey()).toBe('from_config');
    process.env.WEBNAV_KEY = 'from_env';
    expect(resolveApiKey()).toBe('from_env');
    expect(resolveApiKey('explicit')).toBe('explicit');
  });

  it('resolveApiBase falls back to the default when unset', () => {
    expect(resolveApiBase()).toContain('://');           // a real URL
    expect(resolveApiBase('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('fetchHostedMap returns the pack on 200 and sends the key, not credentials', async () => {
    let sentHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchFn = async (_url, init) => { sentHeaders = init?.headers; return { ok: true, status: 200, json: async () => PACK }; };
    const pack = await fetchHostedMap('example.com', { key: 'wn_k', apiBase: 'http://x', fetchImpl });
    expect(pack.node.id).toBe('example.com');
    expect(pack.states).toHaveLength(2);
    expect(sentHeaders?.['X-Webnav-Key']).toBe('wn_k');
    // the request carries ONLY the key header — no credential fields anywhere
    expect(JSON.stringify(sentHeaders)).not.toMatch(/password|secret|credential/i);
  });

  it('throws a clear error when no key is configured', async () => {
    await expect(fetchHostedMap('example.com', { fetchImpl: fakeFetch(200, PACK) }))
      .rejects.toThrow(/API key/i);
  });

  it('maps 401/429/404 to actionable errors', async () => {
    await expect(fetchHostedMap('s', { key: 'k', fetchImpl: fakeFetch(401, {}) })).rejects.toThrow(/invalid or unknown API key/i);
    await expect(fetchHostedMap('s', { key: 'k', fetchImpl: fakeFetch(429, {}) })).rejects.toThrow(/quota/i);
    await expect(fetchHostedMap('s', { key: 'k', fetchImpl: fakeFetch(404, {}) })).rejects.toThrow(/no shared map/i);
  });

  it('rejects a malformed pack', async () => {
    await expect(fetchHostedMap('s', { key: 'k', fetchImpl: fakeFetch(200, { node: null }) })).rejects.toThrow(/malformed/i);
  });

  it('importMapPack populates a store so the same walk path can travel it', () => {
    const store = new MapStore(':memory:');
    importMapPack(store, PACK);
    expect(store.getNode('example.com')).not.toBeNull();
    expect(store.statesForNode('example.com').map((s) => s.id)).toEqual(['example.com:a', 'example.com:b']);
  });
});
