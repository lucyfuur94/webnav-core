import { PlaywrightAdapter } from '../playwright/adapter.js';
import { parseSearchResults } from './search.js';
import { classifyReadiness } from './readiness.js';
import { extractContent, type ContentEvidence } from './extract-content.js';
import { tokenSavings, type TokenSavings } from './tokens.js';
import { SEARCH_PROVIDERS, type SearchProvider } from './search-providers.js';

export interface SearchGatherResult {
  query: string;
  results: { title: string; url: string }[];   // MERGED+deduped results across providers
  evidence: ContentEvidence[];                  // extracted content per visited page
  blocked: string[];                            // result urls that were bot-walled (interstitial) — escalated, not evaded
  providers: { id: string; results: number; blocked: boolean }[];  // per-provider summary
  cost: { playwright_calls: number; savings: TokenSavings };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Snapshot with a readiness retry: re-snapshot up to 3 times while 'loading'.
async function readySnapshot(adapter: PlaywrightAdapter): Promise<{ yaml: string; readiness: ReturnType<typeof classifyReadiness> }> {
  let yaml = await adapter.snapshot();
  let readiness = classifyReadiness(yaml);
  for (let attempt = 1; attempt < 3 && readiness === 'loading'; attempt++) {
    await sleep(1500);
    yaml = await adapter.snapshot();
    readiness = classifyReadiness(yaml);
  }
  return { yaml, readiness };
}

interface ProviderGather {
  results: { title: string; url: string }[];
  blocked: boolean;   // the provider's SEARCH page was bot-walled (interstitial)
  rawChars: number;   // chars snapshotted while gathering from this provider
}

/**
 * Gather results from ONE provider: open its search url, then re-snapshot until
 * results actually parse out (the search shell renders BEFORE the result list —
 * a render race) or a bounded number of attempts. An interstitial search page is
 * recorded as blocked (DETECT + escalate, never evade). Caps to topN.
 */
async function gatherFromProvider(
  adapter: PlaywrightAdapter,
  provider: SearchProvider,
  query: string,
  topN: number,
): Promise<ProviderGather> {
  await adapter.open(provider.searchUrl(query));

  let resultsYaml = '';
  let searchReadiness: ReturnType<typeof classifyReadiness> = 'loading';
  let results: { title: string; url: string }[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const snap = await readySnapshot(adapter);
    resultsYaml = snap.yaml;
    searchReadiness = snap.readiness;
    if (searchReadiness === 'interstitial') break;
    results = parseSearchResults(resultsYaml, topN);
    if (results.length > 0) break;   // results rendered — proceed
    await sleep(1500);               // shell-only render — wait for results
  }

  if (searchReadiness === 'interstitial') {
    // The provider's search page is bot-walled — record + skip. Never evade.
    return { results: [], blocked: true, rawChars: resultsYaml.length };
  }
  // results already parsed in the loop above (possibly empty for a thin index).
  return { results, blocked: false, rawChars: resultsYaml.length };
}

export async function runSearchLive(query: string, topN = 3): Promise<SearchGatherResult> {
  const adapter = new PlaywrightAdapter('search-' + Date.now());
  const evidence: ContentEvidence[] = [];
  const blocked: string[] = [];
  const providers: { id: string; results: number; blocked: boolean }[] = [];
  let rawChars = 0;
  let results: { title: string; url: string }[] = [];

  try {
    // 1. Fan out across providers sequentially (one shared adapter). A blocked
    //    provider is recorded and skipped; the others still contribute (the whole
    //    point — resilience + broader coverage).
    const perProvider: { provider: SearchProvider; gather: ProviderGather }[] = [];
    for (const provider of SEARCH_PROVIDERS) {
      const gather = await gatherFromProvider(adapter, provider, query, topN);
      rawChars += gather.rawChars;
      providers.push({ id: provider.id, results: gather.results.length, blocked: gather.blocked });
      perProvider.push({ provider, gather });
    }

    // 2. MERGE + DEDUPE by url, preserving first-seen order (Marginalia first).
    //    Cap the merged list to topN*2 so both providers can contribute.
    const seen = new Set<string>();
    for (const { gather } of perProvider) {
      for (const r of gather.results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        results.push(r);
      }
    }
    results = results.slice(0, topN * 2);

    // 3. Visit each merged result url, readiness-retry, interstitial -> blocked,
    //    else extract content.
    const queryTerms = query.toLowerCase().split(/\s+/);
    for (const result of results) {
      await adapter.goto(result.url);
      const { yaml, readiness } = await readySnapshot(adapter);
      if (readiness === 'interstitial') {
        // DETECT + escalate, never evade.
        blocked.push(result.url);
        continue;
      }
      rawChars += yaml.length;
      evidence.push(extractContent(yaml, result.url, queryTerms));
    }
  } finally {
    await adapter.close();
  }

  const savings = tokenSavings(rawChars, JSON.stringify({ results, evidence }));
  return { query, results, evidence, blocked, providers, cost: { playwright_calls: adapter.callCount, savings } };
}
