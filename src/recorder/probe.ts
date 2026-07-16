import { NAME_PROBE_JS, enrichName } from './agent-session.js';
import { parseEvalResult } from '../router/browse.js';
import type { SnapNode } from '../playwright/snapshot.js';

/** Interactive roles worth probing for a hidden label when the a11y name is empty. */
export const PROBE_ROLES: Set<string> = new Set([
  'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch',
]);

/** Nodes worth a name-probe: has a ref, role is interactive, and the accessible name is empty. */
export function namelessInteractive(nodes: SnapNode[]): SnapNode[] {
  return nodes.filter((n) => n.ref && PROBE_ROLES.has(n.role) && !(n.name ?? '').trim());
}

/**
 * Ref-scoped NAME_PROBE_JS eval per nameless node, serialized (playwright-cli runs one
 * command at a time per session — concurrent evals would race the same browser tab),
 * capped, best-effort. An eval that throws (stale ref, CSP) just skips that ref — never
 * aborts the batch (#5a: observe, don't fail the recording over one dead control).
 */
export async function probeNames(
  adapter: { evalJs(js: string, ref?: string): Promise<string> },
  nodes: SnapNode[],
  cap = 16,
): Promise<Record<string, string>> {
  const hints: Record<string, string> = {};
  const refs = nodes.map((n) => n.ref).filter((r): r is string => !!r).slice(0, cap);
  for (const ref of refs) {
    let probed: string | null = null;
    try {
      probed = parseEvalResult(await adapter.evalJs(NAME_PROBE_JS, ref));
    } catch {
      continue;   // stale ref / eval failure — skip, never abort the batch
    }
    const name = enrichName(null, probed);
    if (name) hints[ref] = name;
  }
  return hints;
}
