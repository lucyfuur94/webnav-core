// Browser-navigable search engines webnav fans out across. Live-probed: only
// these TWO work cleanly without bot-walling a real browser AND have DIFFERENT
// indexes (Marginalia: broad ~40 results; Wiby: curated/older-web ~8). The
// good mainstream engines (Google/Bing/Brave/DuckDuckGo) bot-wall real browsers;
// others probed (mojeek/ecosia/searx/stract/4get) return empty shells — NOT
// registered. Pure data + a URL builder; no logic.

export interface SearchProvider {
  id: string;                             // 'marginalia' | 'wiby'
  searchUrl: (query: string) => string;   // builds the search URL for a query
}

// Ordered list — Marginalia first (broader index), then Wiby. Merge preserves
// this first-seen order.
export const SEARCH_PROVIDERS: SearchProvider[] = [
  { id: 'marginalia', searchUrl: (q) => 'https://search.marginalia.nu/search?query=' + encodeURIComponent(q) },
  { id: 'wiby',       searchUrl: (q) => 'https://wiby.me/?q=' + encodeURIComponent(q) },
];
