import { parseSnapshot, TOKEN_ROLES, type SnapNode } from '../playwright/snapshot.js';

export type Readiness =
  | 'ready'          // page has real interactive/content nodes; proceed
  | 'loading'        // looks like an unfinished render (sparse/nav-only) — wait & retry
  | 'interstitial';  // a bot-wall / verification screen — escalate, do NOT evade

export interface ReadinessOpts {
  // Minimum non-trivial nodes for a page to count as "ready" (default 8).
  minNodes?: number;
}

// Known bot-wall / verification phrases. These are matched against a lowercased
// blob of all node names to DETECT a hard interstitial so the caller can
// ESCALATE — never to evade it. Each entry is specific enough that ordinary
// prose ("human resources") does not trip it: we match phrases, not bare words.
const INTERSTITIAL_PATTERNS: RegExp[] = [
  /just a moment/,
  /checking your browser/,
  /verify you are (?:a )?human/,
  /cloudflare/,
  /please enable javascript and cookies/,
  /attention required/,
  /ddos protection/,
  /are you a robot/,
  /complete the (?:captcha|security check)/,
];

// Roles that carry real page content. A finished render has at least one such
// node with a non-empty name; a nav-only/empty shell has none.
const CONTENT_ROLES = new Set([
  'heading',
  'paragraph',
  'link',
  'button',
  'listitem',
  'article',
  'cell',
  'textbox',
  'img',
]);

const DEFAULT_MIN_NODES = 8;

/**
 * Classify whether a snapshot represents a ready page, an unfinished render to
 * retry, or a hard interstitial/bot-wall to escalate. Pure + deterministic.
 */
export function classifyReadiness(snapshotYaml: string, opts?: ReadinessOpts): Readiness {
  const minNodes = opts?.minNodes ?? DEFAULT_MIN_NODES;
  const nodes: SnapNode[] = parseSnapshot(snapshotYaml);

  // 1. Lowercased blob of all node names.
  const blob = nodes
    .map((n) => n.name ?? '')
    .join(' ')
    .toLowerCase();

  // 2. Interstitial FIRST: a verification screen can be small AND match these.
  if (INTERSTITIAL_PATTERNS.some((re) => re.test(blob))) {
    return 'interstitial';
  }

  // 3. Loading: too sparse to be a finished render — fewer than minNodes total,
  //    OR no content-ish node with a non-empty name (nav-only/empty shell).
  const hasContent = nodes.some(
    (n) => CONTENT_ROLES.has(n.role.toLowerCase()) && (n.name ?? '').trim() !== '',
  );
  if (nodes.length < minNodes || !hasContent) {
    return 'loading';
  }

  // 4. Ready otherwise.
  return 'ready';
}

// Identity roles for the plateau comparator = TOKEN_ROLES (draft.ts's own fingerprint
// vocabulary), as a Set for O(1) membership.
const IDENTITY_ROLES = new Set(TOKEN_ROLES);

/**
 * Has rendering PLATEAUED between two successive snapshots (settle's truth test, as
 * opposed to classifyReadiness's floor check)? Plateaued = (1) equal parsed node count
 * AND (2) equal sorted multiset of `role:name` identity tokens (TOKEN_ROLES only).
 *
 * Deliberately NOT exact-YAML equality (that's walk.ts's bot-throttle primitive, a
 * different concern): a ticking clock/paragraph mutates text at constant node count on
 * a non-identity role, so it must read as plateaued (map stores structure, not values —
 * the settle budget must not be burned by a live timestamp). Bulk hydration that adds
 * or renames identity nodes (buttons/tabs/headings/…) is NOT plateaued even at equal
 * total count, catching the shell→full-render case the design incident named.
 */
export function snapshotsPlateaued(prevYaml: string, curYaml: string): boolean {
  const prev = parseSnapshot(prevYaml);
  const cur = parseSnapshot(curYaml);
  if (prev.length !== cur.length) return false;
  const tokens = (nodes: SnapNode[]) => nodes
    .filter((n) => IDENTITY_ROLES.has(n.role.toLowerCase()) && (n.name ?? '').trim() !== '')
    .map((n) => `${n.role.toLowerCase()}:${n.name}`)
    .sort();
  const a = tokens(prev);
  const b = tokens(cur);
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}
