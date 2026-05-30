import type { Goal } from '../mapstore/types.js';
import type { Candidate, RecallResponse } from '../protocol.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';

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

/**
 * Is this snapshot node a GitHub owner/repo link? The SINGLE source of truth for
 * candidate selection — live.ts prefetches details using the SAME predicate, so
 * the snapshot stream and recall's iteration stay aligned. A trailing path
 * (e.g. /owner/repo/issues) is excluded: we want repo landing pages only.
 */
export function isRepoLink(n: SnapNode): boolean {
  return n.role === 'link' && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(n.url ?? '');
}

/**
 * One recall. Travels the result list -> top-N candidates -> each detail page,
 * surfaces the goal's signals, and returns the EVIDENCE BUNDLE. webnav does
 * NOT rank - the calling agent does. Zero LLM. Cost = playwright-cli calls.
 */
export function recall(args: RecallArgs): RecallResponse {
  const { query, goal, browser, extractSignals } = args;

  // 1. Result list (search term already injected upstream by the CLI/live wiring).
  const resultNodes = parseSnapshot(browser.nextSnapshot());
  const repoLinks = resultNodes.filter(isRepoLink).slice(0, goal.candidateLimit);

  if (repoLinks.length === 0) {
    return { status: 'failed', reason: 'no repository links found in search results' };
  }

  // 2. Visit each candidate's detail, surface the goal's signals.
  const candidates: Candidate[] = [];
  for (const link of repoLinks) {
    const detail = browser.nextSnapshot();
    const signals = extractSignals(detail);
    candidates.push({ id: link.url!.replace('https://github.com/', ''), url: link.url!, signals });
  }

  // 3. Return raw evidence. No ranking here (principle #5/#5a).
  return {
    status: 'done',
    evidence: {
      goal: goal.name, query, candidates,
      cost: { playwright_calls: browser.callCount() },
    },
  };
}
