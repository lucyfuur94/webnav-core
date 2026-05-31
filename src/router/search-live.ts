import { PlaywrightAdapter } from '../playwright/adapter.js';
import { parseSearchResults } from './search.js';
import { classifyReadiness } from './readiness.js';
import { extractContent, type ContentEvidence } from './extract-content.js';
import { tokenSavings, type TokenSavings } from './tokens.js';

export interface SearchGatherResult {
  query: string;
  results: { title: string; url: string }[];   // the top-N results found
  evidence: ContentEvidence[];                  // extracted content per visited page
  blocked: string[];                            // urls that were bot-walled (interstitial) — escalated, not evaded
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

export async function runSearchLive(query: string, topN = 3): Promise<SearchGatherResult> {
  const adapter = new PlaywrightAdapter('search-' + Date.now());
  const evidence: ContentEvidence[] = [];
  const blocked: string[] = [];
  let rawChars = 0;
  let results: { title: string; url: string }[] = [];

  try {
    await adapter.open('https://search.marginalia.nu/search?query=' + encodeURIComponent(query));

    const { yaml: resultsYaml, readiness: searchReadiness } = await readySnapshot(adapter);
    rawChars += resultsYaml.length;

    if (searchReadiness === 'interstitial') {
      // The search page itself is bot-walled — record + return early. Never evade.
      blocked.push('https://search.marginalia.nu/search?query=' + encodeURIComponent(query));
      const savings = tokenSavings(rawChars, JSON.stringify({ results, evidence }));
      return { query, results, evidence, blocked, cost: { playwright_calls: adapter.callCount, savings } };
    }

    results = parseSearchResults(resultsYaml, topN);

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
  return { query, results, evidence, blocked, cost: { playwright_calls: adapter.callCount, savings } };
}
