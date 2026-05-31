import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';

export interface ContentEvidence {
  url: string;
  // The page's readable content, compacted to the answer-relevant lines.
  text: string;
  // Optionally, lines that matched the query terms (the most relevant snippets).
  relevant: string[];
}

// Roles whose `name` carries human-readable page content (vs. structural chrome).
// `generic`/`text` are included on purpose: real pages stash visible prose in
// generic/text nodes (confirmed against our captured snapshots).
const CONTENT_ROLES = new Set([
  'heading',
  'paragraph',
  'listitem',
  'cell',
  'link',
  'generic',
  'text',
  'button',
  'term',
  'definition',
]);

// Pure nav boilerplate to drop. Matched case-insensitively against the full
// node name. These add no answer signal and only inflate the bundle.
const CHROME = new Set([
  'skip to content',
  'skip to main content',
  'open menu',
  'close menu',
  'menu',
  'search',
  'toggle navigation',
]);

// Cap the compacted text so the bundle stays small — this is the whole point:
// the agent ingests this instead of the full raw snapshot. ~4000 chars with a
// little slack.
const TEXT_CAP = 4000;
// Most-relevant snippets are capped so `relevant` stays a tight shortlist.
const RELEVANT_CAP = 20;

function isChrome(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Drop empty and single-char names (icon labels, bullets, etc.).
  if (lower.length <= 1) return true;
  return CHROME.has(lower);
}

/**
 * Extract answer-relevant readable content from a page snapshot. Zero LLM:
 * pulls human-readable node names (headings, paragraphs, list items, cells,
 * links), drops chrome/noise, and (if query terms given) surfaces the lines
 * that contain those terms as `relevant`. The agent reasons over this compact
 * text instead of the full raw snapshot.
 */
export function extractContent(
  snapshotYaml: string,
  url: string,
  queryTerms?: string[],
): ContentEvidence {
  const nodes: SnapNode[] = parseSnapshot(snapshotYaml);

  const kept: string[] = [];
  for (const node of nodes) {
    if (!CONTENT_ROLES.has(node.role.toLowerCase())) continue;
    const name = node.name?.trim();
    if (!name) continue;
    if (isChrome(name)) continue;
    // Dedupe consecutive identical lines (repeated labels, etc.). Keep order.
    if (kept.length > 0 && kept[kept.length - 1] === name) continue;
    kept.push(name);
  }

  // Compact text, capped for bundle size.
  const text = kept.join('\n').slice(0, TEXT_CAP);

  // Query-relevant lines: any line containing ANY term (case-insensitive).
  // NOTE (v1): terms are matched as plain substrings, so a short term like
  // 'am' can match inside an unrelated word. Accepted simplification — no
  // word-boundary logic for v1.
  let relevant: string[] = [];
  if (queryTerms && queryTerms.length > 0) {
    const terms = queryTerms
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0);
    if (terms.length > 0) {
      for (const line of kept) {
        const lower = line.toLowerCase();
        if (terms.some((t) => lower.includes(t))) {
          relevant.push(line);
          if (relevant.length >= RELEVANT_CAP) break;
        }
      }
    }
  }

  return { url, text, relevant };
}
