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
 */
export function resolveStep(semanticStep: string, nodes: SnapNode[]): string | null {
  const name = quotedName(semanticStep);
  if (!name) return null;
  const hits = nodes.filter((n) => n.ref && n.name === name);
  return hits.length === 1 ? hits[0].ref : null;
}
