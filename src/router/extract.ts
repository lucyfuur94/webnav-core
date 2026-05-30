import { parseSnapshot } from '../playwright/snapshot.js';

function parseStars(text: string): number | undefined {
  const m = text.match(/([\d.,]+)\s*k?\s*stars?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return /k/i.test(m[0]) ? Math.round(n * 1000) : Math.round(n);
}

/** Scrape only the requested goal signals from a repo-detail snapshot. Absent -> omitted. */
export function extractRepoSignals(detailYaml: string, want: string[]): Record<string, unknown> {
  const nodes = parseSnapshot(detailYaml);
  const text = nodes.map((n) => `${n.name ?? ''}`).join(' ');
  const out: Record<string, unknown> = {};
  if (want.includes('stars')) { const s = parseStars(text); if (s !== undefined) out.stars = s; }
  if (want.includes('license')) {
    const lic = nodes.find((n) => /license/i.test(n.name ?? ''));
    if (lic?.name) out.license = lic.name;
  }
  // Additional signals (last_commit, issues, releases) extend here as fixtures reveal structure.
  return out;
}
