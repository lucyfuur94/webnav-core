import { describe, it, expect } from 'vitest';
import { serveMapMetered, period, type Db } from '../site/lib/metering.js';

// Unit-test the hosted API's metered hot path against an in-memory fake Db (no
// live Turso). Covers: key validation, quota enforcement, usage recording, and
// the credentials-never-present invariant (the pack carries only node + states).

function fakeDb(over: Partial<Db> = {}): Db & { usage: any[] } {
  const usage: any[] = [];
  const base: Db = {
    async getKey(key) { return key === 'good' ? { key, tier: 'free' } : (key === 'starter' ? { key, tier: 'starter' } : null); },
    async usageCount(key, per) { return usage.filter((u) => u.key === key && u.per === per).length; },
    async recordUsage(key, site, per, ts) { usage.push({ key, site, per, ts }); },
    async getMap(site) { return site === 'known.com' ? { node: { id: 'known.com', homeUrl: 'h', capabilities: [], topics: [] }, states: [{ id: 'known.com:a' }] } : null; },
    async listMaps() { return [{ site: 'known.com', stateCount: 1 }]; },
    async putKey() { /* noop */ },
  };
  return Object.assign({ usage }, base, over);
}

const PER = '2026-06';

describe('serveMapMetered', () => {
  it('401 when no key', async () => {
    const r = await serveMapMetered(fakeDb(), null, 'known.com', 1, PER);
    expect(r.status).toBe(401);
  });

  it('401 when key is unknown', async () => {
    const r = await serveMapMetered(fakeDb(), 'nope', 'known.com', 1, PER);
    expect(r.status).toBe(401);
  });

  it('404 when the site has no shared map', async () => {
    const r = await serveMapMetered(fakeDb(), 'good', 'unknown.com', 1, PER);
    expect(r.status).toBe(404);
  });

  it('200 returns the map pack and records exactly one usage row', async () => {
    const db = fakeDb();
    const r = await serveMapMetered(db, 'good', 'known.com', 1, PER);
    expect(r.status).toBe(200);
    if (r.status === 200) {
      expect((r.pack.node as any).id).toBe('known.com');
      // the pack is SKELETON ONLY — no credential-shaped fields anywhere
      expect(JSON.stringify(r.pack)).not.toMatch(/password|secret|credential/i);
    }
    expect(db.usage).toHaveLength(1);
  });

  it('enforces the free-tier monthly quota (1000) with 429 once exhausted', async () => {
    const db = fakeDb({ async usageCount() { return 1000; } });  // already at the free limit
    const r = await serveMapMetered(db, 'good', 'known.com', 1, PER);
    expect(r.status).toBe(429);
    expect(db.usage).toHaveLength(0);   // over-quota requests do NOT record/serve
  });

  it('a higher tier has a higher quota (starter not blocked at 1000)', async () => {
    const db = fakeDb({ async usageCount() { return 1000; } });
    const r = await serveMapMetered(db, 'starter', 'known.com', 1, PER);
    expect(r.status).toBe(200);   // starter quota is 25k, 1000 is fine
  });

  it('period() formats YYYY-MM in UTC', () => {
    expect(period(Date.UTC(2026, 5, 10))).toBe('2026-06');   // month is 0-based: 5 = June
  });
});
