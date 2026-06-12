import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Replace the REAL PlaywrightAdapter (which spawns playwright-cli) with an
// offline fake that records the call order and serves a canned snapshot.
const h = vi.hoisted(() => {
  const state = { calls: [] as string[][], yaml: '- heading "Hello" [ref=e1]' };
  class FakePlaywrightAdapter {
    constructor(session: string) { state.calls.push(['new', session]); }
    async open(url: string) { state.calls.push(['open', url]); return ''; }
    async snapshot() { state.calls.push(['snapshot']); return state.yaml; }
    async close() { state.calls.push(['close']); return ''; }
  }
  return { state, FakePlaywrightAdapter };
});
vi.mock('../../src/playwright/adapter.js', () => ({ PlaywrightAdapter: h.FakePlaywrightAdapter }));

import { capture } from '../../src/playwright/capture.js';

describe('capture', () => {
  let tmp: string;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'webnav-capture-')); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('opens the url, writes the snapshot YAML to `out`, and closes the session', async () => {
    const out = join(tmp, 'page.yml');
    await capture('https://example.test/', out);
    expect(readFileSync(out, 'utf8')).toBe(h.state.yaml);
    expect(h.state.calls.map((c) => c[0])).toEqual(['new', 'open', 'snapshot', 'close']);
    expect(h.state.calls[1]).toEqual(['open', 'https://example.test/']);
    expect(h.state.calls[0][1]).toMatch(/^capture-\d+$/);   // fixture-capture session naming
  });
});
