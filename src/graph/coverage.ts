import type { State, Affordance } from '../mapstore/types.js';

// Human-scannable views of a site's interior, for answering "did we capture
// everything?" WITHOUT the React Flow canvas. Two formats over the SAME stored
// data (states + their typed affordance repertoire):
//   • outline  — a flat indented dump you read top-to-bottom and eyeball against
//                the real site.
//   • mermaid  — a `stateDiagram-v2` you paste into GitHub / a markdown viewer /
//                mermaid.live to get a rendered diagram with zero tooling.
// Both surface COMPLETENESS cues: unexplored exits (→ ?), dead-ends, orphans, and
// per-state coverage counts, so gaps in the capture are obvious.

// ── shared traversal ────────────────────────────────────────────────────────

// Flatten a state's affordance tree (recursing into reveal children) into a list
// of [affordance, depth] so reveal overlays render indented under their opener.
function flatten(affs: Affordance[], depth = 0): { aff: Affordance; depth: number }[] {
  const out: { aff: Affordance; depth: number }[] = [];
  for (const a of affs) {
    out.push({ aff: a, depth });
    if (a.children && a.children.length) out.push(...flatten(a.children, depth + 1));
  }
  return out;
}

// A navigate (or a childless reveal) that routes somewhere; reveals WITH children
// don't route themselves (the children do).
function routesSomewhere(a: Affordance): boolean {
  if (a.kind === 'navigate') return true;
  if (a.kind === 'reveal') return !(a.children && a.children.length);
  return false;
}

// ── coverage analysis ────────────────────────────────────────────────────────

export interface StateCoverage {
  id: string;
  counts: Record<AffKind, number>;   // affordances by kind (recursive)
  outgoing: number;                  // explored navigations leaving this state
  unexplored: string[];              // labels of affordances that lead somewhere UNMAPPED
  deadEnd: boolean;                  // no explored outgoing navigation at all
}
type AffKind = 'navigate' | 'reveal' | 'mutate' | 'input';

export interface Coverage {
  node: string;
  entry: string | null;  // the start state — what nothing navigates TO (the root)
  states: StateCoverage[];
  totals: Record<AffKind, number> & { states: number; edges: number; unexplored: number };
  orphans: string[];     // state ids that nothing navigates TO (besides the entry)
  deadEnds: string[];    // state ids with no explored outgoing navigation
}

/** Analyse a node's interior for completeness — counts, unexplored exits,
 *  dead-ends, orphans. Pure: takes the states, returns a report. */
export function analyseCoverage(node: string, states: State[]): Coverage {
  const ids = new Set(states.map((s) => s.id));
  const targeted = new Set<string>();   // states something navigates to
  const totals = { navigate: 0, reveal: 0, mutate: 0, input: 0, states: states.length, edges: 0, unexplored: 0 };

  const perState: StateCoverage[] = states.map((s) => {
    const counts: Record<AffKind, number> = { navigate: 0, reveal: 0, mutate: 0, input: 0 };
    const unexplored: string[] = [];
    let outgoing = 0;
    for (const { aff } of flatten(s.affordances ?? [])) {
      counts[aff.kind]++;
      totals[aff.kind]++;
      if (routesSomewhere(aff)) {
        if (aff.toState) {
          outgoing++;
          totals.edges++;
          targeted.add(aff.toState);
        } else {
          // routes, but the destination isn't mapped → an unexplored exit.
          unexplored.push(aff.label);
          totals.unexplored++;
        }
      }
    }
    return { id: s.id, counts, outgoing, unexplored, deadEnd: outgoing === 0 };
  });

  // Entry = where the flow starts. Prefer a state literally named *login*/*home*/
  // *search*/*index*/*start* (the conceptual entry, even if a back-edge like Logout
  // targets it); else a state nothing navigates TO (a structural root); else the
  // first state. This keeps the entry sensible on cyclic graphs.
  const named = states.find((s) => /login|home|search|index|start/i.test(s.id));
  const untargeted = states.filter((s) => !targeted.has(s.id));
  const entry = (named ?? untargeted[0] ?? states[0])?.id ?? null;
  // Orphans: a non-entry state nothing points to (a real structural gap).
  const orphans = states
    .filter((s) => s.id !== entry && !targeted.has(s.id))
    .map((s) => s.id);
  const deadEnds = perState.filter((s) => s.deadEnd).map((s) => s.id);

  return { node, entry, states: perState, totals, orphans, deadEnds };
}

// ── outline (plain text, top-to-bottom) ──────────────────────────────────────

const KIND_GLYPH: Record<AffKind, string> = { navigate: '→', reveal: '▸', mutate: '·', input: '·' };

/** A flat indented outline of the whole interior. Read top-to-bottom and check
 *  each state + its affordances against the real site. Unexplored exits get a
 *  trailing "?", dead-ends/orphans are flagged, and a coverage summary leads. */
export function toOutline(node: string, states: State[]): string {
  const cov = analyseCoverage(node, states);
  const lines: string[] = [];
  const short = (id: string) => id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;

  lines.push(`# ${node} — interior coverage`);
  lines.push(
    `${cov.totals.states} states · ${cov.totals.edges} mapped navigations · ` +
    `${cov.totals.unexplored} unexplored exits · ` +
    `${cov.totals.navigate} navigate / ${cov.totals.reveal} reveal / ` +
    `${cov.totals.mutate} mutate / ${cov.totals.input} input`);
  if (cov.deadEnds.length) lines.push(`dead-ends (no outgoing nav): ${cov.deadEnds.map(short).join(', ')}`);
  if (cov.orphans.length) lines.push(`orphans (nothing navigates here): ${cov.orphans.map(short).join(', ')}`);
  lines.push('');

  for (const s of states) {
    const sc = cov.states.find((x) => x.id === s.id)!;
    const flags = [sc.deadEnd ? 'DEAD-END' : '', cov.orphans.includes(s.id) ? 'ORPHAN' : '']
      .filter(Boolean).join(' ');
    lines.push(`${short(s.id)}${flags ? '   [' + flags + ']' : ''}`);
    for (const { aff, depth } of flatten(s.affordances ?? [])) {
      const pad = '  '.repeat(depth + 1);
      const glyph = KIND_GLYPH[aff.kind];
      let line = `${pad}${glyph} ${aff.kind}: ${aff.label}`;
      if (aff.kind === 'navigate' || (aff.kind === 'reveal' && routesSomewhere(aff))) {
        line += aff.toState ? `  → ${short(aff.toState)}` : `  → ?  (UNEXPLORED)`;
      } else if (aff.kind === 'reveal') {
        line += '  (opens overlay)';
      }
      if (aff.commit) line += '  [commit · never auto-fired]';
      lines.push(line);
    }
    if (!(s.affordances ?? []).length) lines.push('  (no affordances captured)');
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ── mermaid (stateDiagram-v2) ─────────────────────────────────────────────────

// Mermaid ids must be alnum/underscore. Map a state id to a safe token.
function mid(id: string): string {
  const s = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

/** A Mermaid `stateDiagram-v2` of the interior. Paste into GitHub markdown,
 *  mermaid.live, or any markdown viewer to render. Unexplored exits go to a
 *  shared `unexplored` sink; the entry state gets the `[*]` start marker. */
export function toMermaid(node: string, states: State[]): string {
  const cov = analyseCoverage(node, states);
  const lines: string[] = ['stateDiagram-v2', `  %% ${node} interior`];
  if (cov.entry) lines.push(`  [*] --> ${mid(cov.entry)}`);

  let usedUnexplored = false;
  for (const s of states) {
    // a readable label for the state node
    const label = s.id.includes(':') ? s.id.slice(s.id.indexOf(':') + 1) : s.id;
    lines.push(`  ${mid(s.id)} : ${label}`);
    for (const { aff } of flatten(s.affordances ?? [])) {
      if (!routesSomewhere(aff)) continue;
      const lbl = aff.label.replace(/"/g, "'").replace(/:/g, ' ');
      if (aff.toState) {
        lines.push(`  ${mid(s.id)} --> ${mid(aff.toState)} : ${lbl}${aff.commit ? ' [commit]' : ''}`);
      } else {
        usedUnexplored = true;
        lines.push(`  ${mid(s.id)} --> unexplored : ${lbl} ?`);
      }
    }
  }
  if (usedUnexplored) lines.push('  unexplored : ❓ unexplored');
  // mark dead-ends as terminal so they read as flow ends
  for (const id of cov.deadEnds) lines.push(`  ${mid(id)} --> [*]`);
  return lines.join('\n');
}
