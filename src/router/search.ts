import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';

export interface SearchResult {
  title: string;
  url: string;
}

// Host SUFFIXES that are search chrome / mirrors, not real results. Matched as
// suffixes so the whole Marginalia family (search.marginalia.nu,
// about.marginalia-search.com, etc.) and archive mirrors are all excluded.
const EXCLUDED_HOST_SUFFIXES = ['marginalia.nu', 'marginalia-search.com', 'web.archive.org', 'archive.org'];

function isExcludedHost(host: string): boolean {
  const h = host.toLowerCase();
  return EXCLUDED_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s) || h.includes(s));
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
    if (name === url) continue;
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
