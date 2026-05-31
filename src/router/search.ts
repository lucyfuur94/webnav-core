import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';

export interface SearchResult {
  title: string;
  url: string;
}

// Host SUFFIXES that are search chrome / mirrors / license boilerplate, not real
// results. Suffix-matched so the whole Marginalia family (search.marginalia.nu,
// about.marginalia-search.com), archive mirrors, the engine's footer license
// link (creativecommons.org), and Wiby's own nav/footer (wiby.me) are all
// excluded — same shape across all providers we fan out across.
const EXCLUDED_HOST_SUFFIXES = [
  'marginalia.nu', 'marginalia-search.com', 'web.archive.org', 'archive.org', 'creativecommons.org', 'wiby.me',
];

function isExcludedHost(host: string): boolean {
  const h = host.toLowerCase();
  return EXCLUDED_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s) || h.includes(s));
}

// The engine's own footer/header links can point off-site (e.g. its source repo
// at github.com/MarginaliaSearch). Exclude such chrome URLs by substring.
const EXCLUDED_URL_SUBSTRINGS = ['github.com/MarginaliaSearch', '/MarginaliaSearch/'];

/**
 * A real search RESULT has a descriptive multi-word TITLE; search-engine chrome
 * links are short nav labels ("About", "git repository", "CC-BY-SA 4.0"). Require
 * >=3 whitespace-separated words to separate the dozens of real result titles
 * from the handful of chrome links that otherwise pass host filtering.
 * (Live-found bug: those 3 chrome links were leaking in as "results".)
 */
function looksLikeResultTitle(name: string): boolean {
  return name.trim().split(/\s+/).length >= 3;
}

/** Parse external result links from a Marginalia results snapshot. Pure. */
export function parseSearchResults(resultsYaml: string, limit: number): SearchResult[] {
  const nodes: SnapNode[] = parseSnapshot(resultsYaml);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.role !== 'link') continue;
    const url = n.url;
    if (!url || !url.startsWith('http')) continue;
    const name = n.name?.trim();
    if (!name) continue;
    if (name === url) continue;                 // bare-url duplicate link
    if (!looksLikeResultTitle(name)) continue;  // chrome nav label, not a result title
    if (EXCLUDED_URL_SUBSTRINGS.some((s) => url.includes(s))) continue;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (isExcludedHost(host)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title: name, url });
  }
  return results.slice(0, limit);
}
