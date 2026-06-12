import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the REAL PlaywrightAdapter (which spawns playwright-cli) with an
// offline fake that serves scripted snapshot YAML keyed by the current URL.
const h = vi.hoisted(() => {
  const state = {
    pages: {} as Record<string, string>,
    calls: [] as string[][],
  };
  class FakePlaywrightAdapter {
    callCount = 0;
    private url = '';
    constructor(_session: string) {}
    async open(u: string) { this.callCount++; this.url = u; state.calls.push(['open', u]); return ''; }
    async goto(u: string) { this.callCount++; this.url = u; state.calls.push(['goto', u]); return ''; }
    async close() { this.callCount++; state.calls.push(['close']); return ''; }
    async snapshot() {
      this.callCount++;
      state.calls.push(['snapshot', this.url]);
      const yml = state.pages[this.url];
      if (yml === undefined) throw new Error('no fixture page for ' + this.url);
      return yml;
    }
  }
  return { state, FakePlaywrightAdapter };
});
vi.mock('../../src/playwright/adapter.js', () => ({ PlaywrightAdapter: h.FakePlaywrightAdapter }));

import { runSearchLive } from '../../src/router/search-live.js';
import { SEARCH_PROVIDERS } from '../../src/router/search-providers.js';

const QUERY = 'web agents';
const M_URL = SEARCH_PROVIDERS[0].searchUrl(QUERY);   // marginalia (first-seen order)
const W_URL = SEARCH_PROVIDERS[1].searchUrl(QUERY);   // wiby

// Enough named content nodes that classifyReadiness says 'ready' on the FIRST
// snapshot (>= 8 nodes incl. content roles) — keeps the run free of retry sleeps.
const FILLER = [
  '- heading "Page heading with several words" [ref=e90]',
  '- paragraph "Visible page content line one" [ref=e91]',
  '- paragraph "Visible page content line two" [ref=e92]',
  '- paragraph "Visible page content line three" [ref=e93]',
  '- paragraph "Visible page content line four" [ref=e94]',
  '- paragraph "Visible page content line five" [ref=e95]',
];

const MARGINALIA_PAGE = [...FILLER,
  '- link "Alpha Deep Article About Web Agents" [ref=e1]:',
  '    - /url: https://alpha.example/agents',
  '- link "Shared Result Across Both Engines" [ref=e2]:',
  '    - /url: https://shared.example/post',
].join('\n');

const WIBY_PAGE = [...FILLER,
  '- link "Shared Result Across Both Engines" [ref=e1]:',   // duplicate of marginalia's
  '    - /url: https://shared.example/post',
  '- link "Beta Second Article About Agents" [ref=e2]:',
  '    - /url: https://beta.example/article',
].join('\n');

// A bot-wall: matched by the readiness interstitial patterns regardless of size.
const INTERSTITIAL_PAGE = '- heading "Checking your browser before accessing" [ref=e1]';

function contentPage(title: string): string {
  return [
    `- heading "${title}" [ref=e1]`,
    '- paragraph "Web agents navigate sites deterministically" [ref=e2]',
    ...FILLER,
  ].join('\n');
}

function readyPages(): Record<string, string> {
  return {
    [M_URL]: MARGINALIA_PAGE,
    [W_URL]: WIBY_PAGE,
    'https://alpha.example/agents': contentPage('Alpha article on agents'),
    'https://shared.example/post': contentPage('Shared post about the web'),
    'https://beta.example/article': contentPage('Beta article on agents'),
  };
}

describe('runSearchLive', () => {
  beforeEach(() => {
    h.state.pages = readyPages();
    h.state.calls = [];
  });

  it('fans out across BOTH providers, merges + dedupes by url in first-seen order', async () => {
    const r = await runSearchLive(QUERY, 3);
    // Marginalia first, then wiby's novel result; the shared url appears ONCE.
    expect(r.results.map((x) => x.url)).toEqual([
      'https://alpha.example/agents',
      'https://shared.example/post',
      'https://beta.example/article',
    ]);
    expect(r.providers).toEqual([
      { id: 'marginalia', results: 2, blocked: false },
      { id: 'wiby', results: 2, blocked: false },
    ]);
    expect(r.blocked).toEqual([]);
    // Every merged result was visited + extracted.
    expect(r.evidence.map((e) => e.url)).toEqual(r.results.map((x) => x.url));
    // Query-relevant lines surfaced (substring match on the query terms).
    expect(r.evidence[0].relevant.some((l) => /agents/i.test(l))).toBe(true);
    // Always closes the shared session.
    expect(h.state.calls[h.state.calls.length - 1]).toEqual(['close']);
  });

  it('a bot-walled provider is recorded + skipped; the other still contributes (never evades)', async () => {
    h.state.pages[W_URL] = INTERSTITIAL_PAGE;
    const r = await runSearchLive(QUERY, 3);
    expect(r.providers).toEqual([
      { id: 'marginalia', results: 2, blocked: false },
      { id: 'wiby', results: 0, blocked: true },
    ]);
    // Marginalia's results survive the wiby wall.
    expect(r.results.map((x) => x.url)).toEqual([
      'https://alpha.example/agents',
      'https://shared.example/post',
    ]);
    expect(r.evidence).toHaveLength(2);
    expect(r.blocked).toEqual([]);   // result PAGES were all fine
  });

  it('a bot-walled RESULT page is escalated into blocked, not extracted', async () => {
    h.state.pages['https://shared.example/post'] = INTERSTITIAL_PAGE;
    const r = await runSearchLive(QUERY, 3);
    expect(r.blocked).toEqual(['https://shared.example/post']);
    expect(r.evidence.map((e) => e.url)).toEqual([
      'https://alpha.example/agents',
      'https://beta.example/article',
    ]);
    // It stays a RESULT (the wall is reported honestly, the url isn't hidden).
    expect(r.results.map((x) => x.url)).toContain('https://shared.example/post');
  });

  it('caps each provider to topN and the merged list to topN*2', async () => {
    const r = await runSearchLive(QUERY, 1);
    expect(r.providers).toEqual([
      { id: 'marginalia', results: 1, blocked: false },
      { id: 'wiby', results: 1, blocked: false },
    ]);
    expect(r.results.map((x) => x.url)).toEqual([
      'https://alpha.example/agents',     // marginalia's top-1
      'https://shared.example/post',      // wiby's top-1 (distinct -> kept; <= topN*2)
    ]);
    expect(r.evidence).toHaveLength(2);
  });

  it('reports the cost block: real playwright call count + token-savings estimate', async () => {
    const r = await runSearchLive(QUERY, 3);
    // 2*(open+snapshot) + 3*(goto+snapshot) + close = 11 calls on the shared adapter.
    expect(r.cost.playwright_calls).toBe(11);
    expect(r.cost.savings.raw_snapshot_tokens).toBeGreaterThan(0);
    expect(r.cost.savings.tokens_saved).toBeGreaterThanOrEqual(0);
    expect(r.query).toBe(QUERY);
  });
});
