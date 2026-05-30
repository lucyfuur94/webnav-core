import type { Goal } from '../mapstore/types.js';
import type { Candidate, RecallResponse } from '../protocol.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { tokenSavings } from './tokens.js';

export interface RecallBrowser {
  callCount: () => number;
  nextSnapshot: () => string;   // advances through the route, returns snapshot YAML
}

export interface RecallArgs {
  query: string;
  goal: Goal;
  browser: RecallBrowser;
  /** Extract goal signals from a repo-detail snapshot (absent signals omitted). */
  extractSignals: (detailYaml: string) => Record<string, unknown>;
}

// Top-level GitHub paths that look like owner/repo but aren't repositories.
const NON_REPO_OWNERS = new Set([
  'sponsors', 'search', 'marketplace', 'topics', 'collections', 'trending',
  'explore', 'orgs', 'users', 'settings', 'notifications', 'about', 'features',
  'pricing', 'login', 'join', 'new', 'codespaces', 'apps',
]);

/**
 * If this node is a GitHub owner/repo RESULT link, return its normalized absolute
 * URL; otherwise null. The SINGLE source of truth for candidate selection —
 * live.ts prefetches details using the SAME helper, so the snapshot stream and
 * recall's iteration stay aligned.
 *
 * Real GitHub search results link via a RELATIVE `/owner/repo` url with a name
 * like "owner/repo" (verified live), while a repo detail page may carry an
 * absolute url. Accept both; require exactly two clean path segments (no
 * `/owner/repo/issues` sub-paths); exclude non-repo top-level paths.
 */
export function repoUrl(n: SnapNode): string | null {
  if (n.role !== 'link') return null;
  const raw = n.url ?? '';
  const m = raw.match(/^(?:https:\/\/github\.com)?\/([^/?#]+)\/([^/?#]+)\/?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (NON_REPO_OWNERS.has(owner.toLowerCase())) return null;
  return `https://github.com/${owner}/${repo}`;
}

/** Boolean form of `repoUrl` (kept for call sites that only need the predicate). */
export function isRepoLink(n: SnapNode): boolean {
  return repoUrl(n) !== null;
}

/**
 * One recall. Travels the result list -> top-N candidates -> each detail page,
 * surfaces the goal's signals, and returns the EVIDENCE BUNDLE. webnav does
 * NOT rank - the calling agent does. Zero LLM. Cost = playwright-cli calls.
 */
export function recall(args: RecallArgs): RecallResponse {
  const { query, goal, browser, extractSignals } = args;

  // Track total raw-snapshot size webnav ingests on the agent's behalf. This is
  // what the agent would otherwise have had to read into its own LLM context.
  let rawSnapshotChars = 0;

  // 1. Result list (search term already injected upstream by the CLI/live wiring).
  const resultsYaml = browser.nextSnapshot();
  rawSnapshotChars += resultsYaml.length;
  const resultNodes = parseSnapshot(resultsYaml);
  // Resolve each result link to its normalized absolute repo URL (handles the
  // relative `/owner/repo` form GitHub search actually emits). Dedupe by URL
  // since a result row can carry multiple links to the same repo.
  const seen = new Set<string>();
  const repoUrls: string[] = [];
  for (const n of resultNodes) {
    const u = repoUrl(n);
    if (u && !seen.has(u)) { seen.add(u); repoUrls.push(u); }
    if (repoUrls.length >= goal.candidateLimit) break;
  }

  if (repoUrls.length === 0) {
    return { status: 'failed', reason: 'no repository links found in search results' };
  }

  // 2. Visit each candidate's detail, surface the goal's signals.
  const candidates: Candidate[] = [];
  for (const url of repoUrls) {
    const detail = browser.nextSnapshot();
    rawSnapshotChars += detail.length;
    const signals = extractSignals(detail);
    candidates.push({ id: url.replace('https://github.com/', ''), url, signals });
  }

  // 3. Return raw evidence. No ranking here (principle #5/#5a). The cost block
  //    reports the agent LLM tokens webnav saved: raw snapshots it parsed (which
  //    the agent would otherwise ingest) vs. the compact bundle the agent receives.
  const bundleCore = { goal: goal.name, query, candidates };
  const savings = tokenSavings(rawSnapshotChars, JSON.stringify(bundleCore));
  return {
    status: 'done',
    evidence: {
      ...bundleCore,
      cost: { playwright_calls: browser.callCount(), savings },
    },
  };
}
