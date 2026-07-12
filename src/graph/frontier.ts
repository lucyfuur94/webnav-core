import type { State, Affordance } from '../mapstore/types.js';

// The UNEXPLORED FRONTIER of a node's map: every declared affordance the map has
// NOT followed to a resolved state. Purely from stored data (zero LLM) so that
// "is exploration complete?" is MEASURED, not guessed. Drive the frontier to
// empty (minus the caller's hard exclusions) and the walkthrough is complete.
//
// Three kinds of frontier item (see `reason`):
//   • dangling-target — a navigate/reveal with toState === null: we recorded the
//     opener but never captured where it leads.
//   • ambiguous-action — a mutate/input whose label does NOT match a known
//     in-place-action shape (sort/refresh/pagination/toggle/…). It MIGHT open
//     something an explorer should verify (e.g. an account/model switcher).
//   • unopened-panel — a reveal whose children were never captured (null/empty):
//     opener seen, panel contents never recorded.
//
// NOT flagged: resolved navigates (toState set), reveals WITH children, clearly
// in-place mutates, and per-row/widget scope templates (already generalized).

export type FrontierReason = 'dangling-target' | 'ambiguous-action' | 'unopened-panel';

export interface FrontierItem {
  state: string;         // owning state id
  kind: Affordance['kind'];
  label: string;
  reason: FrontierReason;
  hint: string;          // one short human line: what to do about it
}

export interface Frontier {
  status: 'ok';
  node: string;
  total: number;
  frontier: FrontierItem[];
  excluded: FrontierItem[];          // items matched by a caller --exclude label
  byState: Record<string, number>;   // frontier (not excluded) counts per state
}

// In-place-action shapes: labels that CLEARLY don't open a new surface, so a
// mutate/input carrying one is NOT frontier. Declared-evidence only — matched on
// the affordance's own label text, case-insensitively, as a whole-word/substring
// signal. Grouped by the shape the task named (sort/refresh/pagination/toggle)
// plus the obviously-in-place widget controls the demo maps declare. This list is
// the knob: too broad and a real switcher hides; too narrow and every button
// screams "explore me". Tune it here, never downstream.
const IN_PLACE_SHAPES: RegExp[] = [
  // pagination
  /\bpage\b/i, /\bpage size\b/i, /first page/i, /previous page/i, /next page/i, /last page/i,
  // refresh / reload
  /\brefresh\b/i, /\breload\b/i,
  // sort / order
  /\bsort\b/i, /ascending/i, /descending/i, /order by/i,
  // toggle / select / check (row + column selection, dark mode, legend items)
  /toggle/i, /\bcheck(ed|box)?\b/i, /uncheck/i, /select all/i, /deselect/i, /row selection/i,
  /dark mode/i, /light mode/i, /\blegend\b/i,
  // dismiss / close / cancel (overlay teardown, never a new surface)
  /\bclose\b/i, /\bcancel\b/i, /dismiss/i, /\bdone\b/i,
  // in-place view controls the analytics maps declare (chart axis / column tweaks)
  /secondary axis/i, /^remove\b/i, /view all/i, /expand drilldown/i, /full screen/i,
  /\bcolumns?\b/i, /\bfunctions?\b/i,
  // search / filter inputs (an input labeled "search…" filters in place; opens nothing)
  /search/i, /\bfilter\b/i,
  // form-fill inputs — a field you type INTO (login creds, checkout, "enter X").
  // Per the affordance model an input never routes; it's a precondition, not a
  // surface to open. So a plainly-labeled field is in-place, not frontier.
  /^enter /i, /^type /i, /username/i, /password/i, /e-?mail/i,
  // add-to-cart / add-X is the canonical declared in-place MUTATE (affordance
  // model: add-to-cart never routes; the empty cart is a valid state).
  /add .*(to|an item)/i, /^add\b/i,
];

function isInPlace(label: string): boolean {
  return IN_PLACE_SHAPES.some((re) => re.test(label));
}

// A reveal that exposes children is already-explored; a navigate/reveal that
// resolved to a state is already-explored. `scope` templates are generalized.
function isGeneralized(a: Affordance): boolean {
  return a.scope === 'row' || a.scope === 'widget';
}

const HINTS: Record<FrontierReason, string> = {
  'dangling-target': 'follow this to capture where it leads',
  'ambiguous-action': 'fire this and see if it opens a new surface to map',
  'unopened-panel': 'open this and record the panel contents',
};

/**
 * Compute a node's unexplored frontier from its stored states. Pure: takes the
 * states, returns the report. `exclude` = the caller's hard "never click" labels
 * (matched case-insensitively as a substring); matched items are moved to
 * `excluded` (visible, not on the worklist) rather than dropped.
 */
export function computeFrontier(node: string, states: State[], exclude: string[] = []): Frontier {
  const frontier: FrontierItem[] = [];
  const excluded: FrontierItem[] = [];
  const exLower = exclude.map((e) => e.toLowerCase());

  // A reveal's children are its EXPOSED affordances, not a separate frontier item
  // to open — so we do NOT recurse into children here (unlike coverage's flatten).
  // We only judge each state's TOP-LEVEL declared affordances.
  const consider = (state: string, a: Affordance): FrontierItem | null => {
    if (isGeneralized(a)) return null;
    if (a.kind === 'navigate') {
      // resolved navigate → done; dangling navigate → frontier
      return a.toState ? null
        : { state, kind: a.kind, label: a.label, reason: 'dangling-target', hint: HINTS['dangling-target'] };
    }
    if (a.kind === 'reveal') {
      if (a.children && a.children.length) return null;   // panel captured
      // an unopened reveal: opener seen, no children (and no toState) → frontier
      return { state, kind: a.kind, label: a.label, reason: 'unopened-panel', hint: HINTS['unopened-panel'] };
    }
    // mutate | input: frontier only if the label is NOT a known in-place shape
    if (isInPlace(a.label)) return null;
    return { state, kind: a.kind, label: a.label, reason: 'ambiguous-action', hint: HINTS['ambiguous-action'] };
  };

  for (const s of states) {
    for (const a of s.affordances ?? []) {
      const item = consider(s.id, a);
      if (!item) continue;
      if (exLower.some((e) => item.label.toLowerCase().includes(e))) excluded.push(item);
      else frontier.push(item);
    }
  }

  const byState: Record<string, number> = {};
  for (const item of frontier) byState[item.state] = (byState[item.state] ?? 0) + 1;

  return { status: 'ok', node, total: frontier.length, frontier, excluded, byState };
}
