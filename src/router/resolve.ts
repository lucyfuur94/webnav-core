import type { SnapNode } from '../playwright/snapshot.js';

// Pull the quoted name out of a semantic step like `click "Insights"`.
function quotedName(semanticStep: string): string | null {
  const m = semanticStep.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Deterministically map a semantic step to a live element ref by matching the
 * step's quoted name against snapshot node names. Returns null on no/ambiguous
 * match — the caller then escalates to the agent (needs-navigation). No LLM.
 *
 * Strict by design: it returns a ref ONLY when exactly one node carries the
 * name. If several do (e.g. 6 equivalent "Add to cart" buttons, or a product
 * label shared by a link + its image), it returns null and the caller escalates
 * — webnav never guesses among genuinely-equivalent targets; that judgment is
 * the agent's (principle #5a). This is correct behavior, not a limitation.
 */
export function resolveStep(semanticStep: string, nodes: SnapNode[]): string | null {
  const name = quotedName(semanticStep);
  if (!name) return null;
  const hits = nodes.filter((n) => n.ref && n.name === name);
  return hits.length === 1 ? hits[0].ref : null;
}
