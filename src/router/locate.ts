import type { Coordinate, LocateResponse } from '../protocol.js';

/**
 * The GAZETTEER: webnav's place index — "X lives at this address".
 * This is the place-lookup half of the map (Google Maps "Search a place",
 * not "Directions"). Entries are addressable places with a canonical URL the
 * agent can `goto` directly — no routing, no navigation, no browser needed.
 *
 * Zero LLM: matching is deterministic on a normalized name + aliases. A place
 * the gazetteer doesn't know returns `unknown` (the agent can then `recall` /
 * explore to discover it — and that discovery can be written back here later).
 *
 * v1 seeds the obvious GitHub addressable places. `{repo}` is a runtime slot:
 * `locate('repo facebook/react')` resolves to https://github.com/facebook/react.
 */
interface GazetteerEntry {
  /** Canonical name of the place. */
  canonical: string;
  /** Alternate phrasings an agent might use. */
  aliases: string[];
  /** Canonical URL coordinate. May contain a `{repo}` slot filled from the query tail. */
  url: string;
}

const GITHUB_GAZETTEER: GazetteerEntry[] = [
  { canonical: 'trending repositories', aliases: ['trending', 'trending repos', 'what is trending'],
    url: 'https://github.com/trending' },
  { canonical: 'trending developers', aliases: ['trending devs'],
    url: 'https://github.com/trending/developers' },
  { canonical: 'repository search', aliases: ['search repos', 'repo search', 'search repositories'],
    url: 'https://github.com/search?type=repositories' },
  { canonical: 'explore', aliases: ['explore github', 'discover'],
    url: 'https://github.com/explore' },
  { canonical: 'repo', aliases: ['repository', 'repo overview', 'project'],
    url: 'https://github.com/{repo}' },
];

/** Lowercase, collapse whitespace, strip surrounding quotes/punctuation. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Look up where a place is, returning its coordinate WITHOUT navigating.
 * Returns `found` with a `url` coordinate for known addressable places,
 * else `unknown`. The `{repo}` slot is filled from an `owner/repo` token
 * anywhere in the query (e.g. "repo facebook/react").
 */
export function locate(place: string, gazetteer: GazetteerEntry[] = GITHUB_GAZETTEER): LocateResponse {
  const q = normalize(place);

  for (const entry of gazetteer) {
    const names = [entry.canonical, ...entry.aliases].map(normalize);
    const matched = names.some((n) => q === n || q.startsWith(n + ' ') || q.endsWith(' ' + n) || q.includes(' ' + n + ' '));
    if (!matched && !q.includes(normalize(entry.canonical))) continue;

    let url = entry.url;
    if (url.includes('{repo}')) {
      const repo = q.match(/([\w.-]+\/[\w.-]+)/)?.[1];
      if (!repo) continue; // a {repo} place needs an owner/repo token to be addressable
      url = url.replace('{repo}', repo);
    }
    const coordinate: Coordinate = { kind: 'url', url };
    return { status: 'found', place: entry.canonical, coordinate };
  }

  return { status: 'unknown', place };
}
