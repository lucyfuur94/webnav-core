import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';

function toInt(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10);
}

/**
 * Stars: PREFER the exact integer in "<N> users starred this repository".
 * Fall back to a "12.3k stars"-style count only if the exact form is absent.
 * Scanned across all node names (the exact form lives in a `generic` node, the
 * fallback in a `link`).
 */
function extractStars(nodes: SnapNode[]): number | undefined {
  for (const n of nodes) {
    const m = (n.name ?? '').match(/([\d,]+)\s+users?\s+starred/i);
    if (m) return toInt(m[1]);
  }
  for (const n of nodes) {
    const m = (n.name ?? '').match(/([\d.,]+)\s*(k?)\s*stars?/i);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      return /k/i.test(m[2]) ? Math.round(v * 1000) : Math.round(v);
    }
  }
  return undefined;
}

/**
 * Count signals (forks/issues/prs/commits/tags) live in `link` names like
 * `Fork 322`, `Issues 18`, `586 Commits`. We match per-node name with an
 * anchored regex rather than scanning joined text: joined text risks one
 * signal's regex grabbing a neighbouring node's number, while per-node matching
 * keeps each count bound to its own element.
 */
function extractCount(nodes: SnapNode[], re: RegExp): number | undefined {
  for (const n of nodes) {
    const m = (n.name ?? '').match(re);
    if (m) return toInt(m[1]);
  }
  return undefined;
}

/**
 * last_commit: the date right after "· " in the latest-commit row, e.g.
 * "... · May 22, 2026last week". The regex captures only the
 * "<Mon> <D>, <YYYY>" date and stops before the trailing relative time, so
 * "last week"/"yesterday"/"N days ago" is never grabbed.
 */
function extractLastCommit(nodes: SnapNode[]): string | undefined {
  for (const n of nodes) {
    const m = (n.name ?? '').match(/·\s+([A-Z][a-z]{2,8} \d{1,2}, \d{4})/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * license: the repo's declared license NAME, not a file-tree entry. GitHub shows
 * it as a sidebar link like "MIT License" or "AGPL-3.0 license". We must REJECT
 * file-tree rows such as "LICENSE, (File)" / "AUTHORS, (File) ..." which also
 * contain the word "license" but are files, not the license itself.
 * Accept: "<SPDX-ish> license" (e.g. "MIT License", "AGPL-3.0 license",
 * "Apache-2.0 license", "BSD-3-Clause License"). Reject anything with "(File)"
 * or "(Directory)" — those are tree entries.
 */
function extractLicense(nodes: SnapNode[]): string | undefined {
  const LICENSE_NAME = /^([\w.\-+]+(?: [\w.\-+]+)*) Licen[sc]e$/i;
  for (const n of nodes) {
    const name = (n.name ?? '').trim();
    if (/\((?:File|Directory)\)/i.test(name)) continue; // tree entry, not the license
    if (LICENSE_NAME.test(name)) return name;
  }
  return undefined;
}

/** Scrape only the requested goal signals from a repo-detail snapshot. Absent -> omitted. */
export function extractRepoSignals(detailYaml: string, want: string[]): Record<string, unknown> {
  const nodes = parseSnapshot(detailYaml);
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown): void => {
    if (value !== undefined) out[key] = value;
  };

  if (want.includes('stars')) set('stars', extractStars(nodes));
  if (want.includes('forks')) set('forks', extractCount(nodes, /Fork\s+([\d,]+)/));
  if (want.includes('open_issues')) set('open_issues', extractCount(nodes, /Issues\s+([\d,]+)/));
  if (want.includes('open_prs')) set('open_prs', extractCount(nodes, /Pull requests\s+([\d,]+)/));
  if (want.includes('commits')) set('commits', extractCount(nodes, /([\d,]+)\s+Commits/));
  if (want.includes('tags')) set('tags', extractCount(nodes, /([\d,]+)\s+Tags/));
  if (want.includes('last_commit')) set('last_commit', extractLastCommit(nodes));
  if (want.includes('license')) set('license', extractLicense(nodes));

  return out;
}
