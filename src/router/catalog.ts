import type { Goal } from '../mapstore/types.js';
import type { GazetteerEntry } from './locate.js';

/**
 * Discovery / coverage layer — the Google-Maps capabilities that exist BEFORE
 * you ask for directions: "what's on this map?" (list) and "what's at A?"
 * (describe). Both are pure reads over the gazetteer + goal registry — zero
 * browser, zero LLM. They solve the agent's discovery problem: you can't route
 * to a place you don't know is on the map.
 *
 * NOTE (2026-06-12 product decision): the GitHub gazetteer + github-repos goal
 * are parked FIXTURE data, not an advertised product surface, so `dev list` /
 * `dev describe` no longer surface them by default. Callers inject the gazetteer
 * / goals they actually want listed (the defaults are empty), so the kept dev
 * surface shows only what's genuinely in the user's map.
 */

export interface PlaceListing {
  place: string;
  site: string;
  url: string;          // canonical URL (may contain a {repo} slot)
  aliases: string[];
}

export interface Coverage {
  sites: string[];                 // sites webnav knows anything about
  places: PlaceListing[];          // directly-locatable places (the gazetteer)
  goals: { name: string; surfaces: string[] }[]; // runnable goals + signals they surface
}

/**
 * `list` — the table of contents. What does webnav know? Returns the known
 * sites, every directly-locatable place, and the runnable goals. The agent
 * reads this to learn what it can ask for (and, by absence, the coverage gaps).
 */
export function listCoverage(
  gazetteer: GazetteerEntry[] = [],
  goals: Goal[] = [],
): Coverage {
  const places = gazetteer.map((e) => ({
    place: e.canonical, site: e.site, url: e.url, aliases: e.aliases,
  }));
  const sites = [...new Set(gazetteer.map((e) => e.site))].sort();
  return {
    sites,
    places,
    goals: goals.map((g) => ({ name: g.name, surfaces: Object.values(g.surface).flat() })),
  };
}

export type DescribeResponse =
  | { status: 'found'; place: string; site: string; url: string; affordances: string[] }
  | { status: 'unknown'; place: string };

/**
 * `describe` — "what's at A and what can I do there?" The tap-a-pin verb. Given
 * a place name/alias, return its address plus its affordances (what's readable
 * or doable there). Deterministic name match against the gazetteer; no browser.
 */
export function describePlace(
  place: string,
  gazetteer: GazetteerEntry[] = [],
): DescribeResponse {
  const q = place.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  const entry = gazetteer.find((e) =>
    [e.canonical, ...e.aliases].some((n) => n.toLowerCase() === q));
  if (!entry) return { status: 'unknown', place };
  return {
    status: 'found', place: entry.canonical, site: entry.site,
    url: entry.url, affordances: entry.affordances ?? [],
  };
}
