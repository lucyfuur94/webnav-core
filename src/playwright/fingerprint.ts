import type { SnapNode } from './snapshot.js';

// A durable, layered identifier for the element a walk step targets — the map KEY that
// survives redesigns (vs the disposable selector cache). Design + proof:
// docs/superpowers/specs/2026-06-13-element-fingerprint-design.md and the runnable
// proof docs/superpowers/artifacts/fingerprint-algo-prototype.mjs (this module is the
// production port of that prototype, locked to the committed fixtures by tests).
export interface ElementFingerprint {
  role: string;                 // layer 1 — ARIA role (button/link/heading/textbox)
  name: string | null;         // layer 1 — accessible name (the QUOTED snapshot name)
  testId?: string | null;      // layer 2 — opportunistic exact key (absent from a11y snapshots in v1)
  placeholder?: string | null; // layer 2
  near?: string | null;        // layer 3 — a distinguishing CONTENT text in the target's row/card
}

// ─── layer-3 anchor (the `near` content disambiguator) ───────────────────────
// All structural, zero-LLM. Verified against tests/fixtures/{saucedemo-inventory,
// orangehrm-pim-table}.yml.

/** Ancestors of a node: preceding nodes at strictly-decreasing depth, nearest first. */
function ancestorsOf(nodes: SnapNode[], idx: number): { node: SnapNode; idx: number }[] {
  const out: { node: SnapNode; idx: number }[] = [];
  let minDepth = nodes[idx].depth;
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].depth < minDepth) { out.push({ node: nodes[i], idx: i }); minDepth = nodes[i].depth; }
  }
  return out;
}

/** Does ancestor A's bounded subtree (until the next node at depth <= A.depth) contain
 *  a node matching `pred`? */
function subtreeHas(nodes: SnapNode[], aIdx: number, aDepth: number, pred: (n: SnapNode, j: number) => boolean): boolean {
  for (let j = aIdx + 1; j < nodes.length; j++) {
    if (nodes[j].depth <= aDepth) break;
    if (pred(nodes[j], j)) return true;
  }
  return false;
}

/** The LARGEST enclosing ancestor of `candIdx` whose bounded subtree EXCLUDES every other
 *  candidate (the candidate's per-row/card scope) — or null if none (flat page). NOT the
 *  nearest container (too small) and NOT the smallest-containing-near (too big). */
function anchorScope(nodes: SnapNode[], candIdx: number, others: Set<number>): { node: SnapNode; idx: number } | null {
  let scope: { node: SnapNode; idx: number } | null = null;
  for (const a of ancestorsOf(nodes, candIdx)) {
    if (subtreeHas(nodes, a.idx, a.node.depth, (_n, j) => j !== candIdx && others.has(j))) break;  // pulls in a sibling candidate → stop
    scope = a;  // still clean → remember, try larger
  }
  return scope;
}

/** Given a `near` text, which of `candidateIdxs` have it inside their clean anchor scope. */
export function resolveByNear(nodes: SnapNode[], candidateIdxs: number[], near: string): number[] {
  const set = new Set(candidateIdxs);
  const hits: number[] = [];
  for (const ci of candidateIdxs) {
    const scope = anchorScope(nodes, ci, set);
    if (!scope) continue;
    if (subtreeHas(nodes, scope.idx, scope.node.depth, (n, j) => j !== ci && n.name === near)) hits.push(ci);
  }
  return hits;
}

/** Stability score for a candidate `near` text (HIGHER = more durable). Prefers anchors
 *  that survive content edits/i18n: +3 id-like (3+ digit run), +0..1 length, -2 free-text
 *  prose (space + no digit). Pure, deterministic. */
export function nearStability(text: string): number {
  let s = 0;
  if (/\d{3,}/.test(text)) s += 3;
  s += Math.min(text.length, 40) / 40;
  if (/\s/.test(text) && !/\d/.test(text)) s -= 2;
  return s;
}

/** Text-bearing names inside `scope` (doc order, excluding the candidate, skip empty). */
function scopeTexts(nodes: SnapNode[], scope: { node: SnapNode; idx: number }, candIdx: number): string[] {
  const out: string[] = [];
  for (let j = scope.idx + 1; j < nodes.length; j++) {
    if (nodes[j].depth <= scope.node.depth) break;
    if (j !== candIdx && nodes[j].name && nodes[j].name!.trim()) out.push(nodes[j].name!);
  }
  return out;
}

/**
 * Choose WHICH text to store as `near` for a target candidate (the matcher's twin —
 * used at BOTH record-time and step-5 heal so they never diverge). Collect every
 * text in the candidate's clean scope that UNIQUELY resolves to it, then pick the MOST
 * STABLE (nearStability desc; doc order tiebreak). null = honest "can't make unique" flag
 * (a truly content-identical sibling) → the caller escalates.
 */
export function deriveNear(nodes: SnapNode[], candIdx: number, role: string, name: string | null): string | null {
  const cands = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.role === role && x.n.name === name && x.n.ref).map((x) => x.i);
  if (cands.length <= 1) return null;                       // unique by role+name → no near needed
  if (!cands.includes(candIdx)) return null;
  const scope = anchorScope(nodes, candIdx, new Set(cands));
  if (!scope) return null;
  const qualifying = scopeTexts(nodes, scope, candIdx).filter((t) => {
    const hits = resolveByNear(nodes, cands, t);
    return hits.length === 1 && hits[0] === candIdx;
  });
  if (qualifying.length === 0) return null;                 // honest flag → escalate
  qualifying.sort((a, b) => nearStability(b) - nearStability(a));  // prefer durable anchors (D3)
  return qualifying[0];
}

// ─── resolution (the read path) ──────────────────────────────────────────────

/**
 * Resolve an ElementFingerprint to a live element ref, deterministically (zero-LLM).
 * Strict order:
 *  1. testId (when present) + role match → unique? return it. (Inert in v1: a11y snapshots
 *     carry no testid; testId never overrides the durable role+name key.)
 *  2. candidates = role==fp.role AND name==fp.name. 1 → return; 0 → null (drift); >1 → step 3.
 *  3. fp.near present → resolveByNear; exactly 1 → return; else null (escalate).
 * Returns null on no/ambiguous match — the caller escalates to the agent (#5a).
 */
export function resolveByFingerprint(fp: ElementFingerprint, nodes: SnapNode[]): string | null {
  if (fp.testId) {
    const hits = nodes.filter((n) => n.ref && (n as any).testId === fp.testId && n.role === fp.role);
    if (hits.length === 1) return hits[0].ref;
    // else fall through — testId is a hint, never an override of role+name
  }
  const cands = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.ref && x.n.role === fp.role && x.n.name === fp.name);
  if (cands.length === 1) return cands[0].n.ref;
  if (cands.length === 0) return null;
  if (!fp.near) return null;                                // genuinely ambiguous, no anchor → escalate
  const hits = resolveByNear(nodes, cands.map((c) => c.i), fp.near);
  return hits.length === 1 ? nodes[hits[0]].ref : null;
}
