import { classifyReadiness } from './readiness.js';
import { extractContent, type ContentEvidence } from './extract-content.js';

export type ReadResponse =
  | { status: 'done'; url: string; content: ContentEvidence; raw?: string }
  | { status: 'blocked'; url: string; reason: string }
  | { status: 'failed'; url: string; reason: string };

export interface ReadOpts {
  raw?: boolean;
  queryTerms?: string[];
}

/**
 * Open a URL and return its DISTILLED content (or the raw snapshot with --raw).
 * Zero-LLM: readiness + extraction are deterministic. On a loading/interstitial
 * page we report `blocked` and do NOT evade (principle: detect, never bypass).
 * `fetchSnapshot` is injected so this is unit-testable without a browser.
 */
export async function readUrl(
  url: string,
  fetchSnapshot: (url: string) => Promise<string>,
  opts: ReadOpts = {},
): Promise<ReadResponse> {
  let snapshot: string;
  try {
    snapshot = await fetchSnapshot(url);
  } catch (e) {
    return { status: 'failed', url, reason: String(e) };
  }

  const readiness = classifyReadiness(snapshot);
  if (readiness !== 'ready') {
    return {
      status: 'blocked',
      url,
      reason: `page not ready (${readiness}); webnav does not evade walls`,
    };
  }

  const content = extractContent(snapshot, url, opts.queryTerms);
  if (opts.raw) {
    return { status: 'done', url, content, raw: snapshot };
  }
  return { status: 'done', url, content };
}
