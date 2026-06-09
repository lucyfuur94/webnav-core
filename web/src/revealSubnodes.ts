// Reveal sub-node synthesis (VIEWER-ONLY).
//
// The data model intentionally keeps an overlay (e.g. the burger menu) as a NESTED
// reveal affordance with `children` — the overlay has no URL/state of its own, so
// the backend never emits a separate node for it. The VIEWER renders that overlay
// as a beside-it SUB-NODE that holds the options, instead of nesting them inside
// the parent. This module synthesises those sub-nodes + the edges around them from
// the interior view's states/edges, leaving the backend untouched.
//
// For each interior state S with a reveal affordance R that has non-empty children:
//   • a synthetic SUB-NODE id `S.id + '::' + R.id` (affordances = R.children),
//   • a parent→sub-node REVEAL edge (purple "opens overlay"), anchored to R's port,
//   • the children's projected edges (emitted by the API as {from:S, viaAffordance:
//     childId}) are RE-POINTED so their source is the sub-node, not the parent.
// Nested overlays (a child that is itself a reveal-with-children) recurse.
import type { LayoutEdge, LayoutNode } from './layout.js';

// Minimal shapes — we only touch the fields used here (keeps this decoupled from
// the @server types, which carry many more fields).
export interface AffLike {
  id: string;
  label: string;
  kind: string;
  children?: AffLike[] | null;
}
export interface StateLike {
  id: string;
  semanticName: string;
  role: string;
  availableSignals: string[];
  affordances?: AffLike[];
}
export interface InteriorEdgeLike {
  from: string;
  to: string | null;
  semanticStep: string;
  kind: string;
  viaAffordance: string;
  core: boolean;
  dangling?: boolean;
}

export interface SubState {
  id: string;
  semanticName: string;
  role: string;
  availableSignals: string[];
  affordances: AffLike[];
  parent: string;
}

export interface RevealSynthesis {
  subStates: SubState[];
  /** parent → sub-node edges (purple "opens overlay"); ids 'rev0', 'rev1', … */
  revealEdges: LayoutEdge[];
  /** childAffId → owning sub-node id, used to re-point child edges' source. */
  childOwner: Map<string, string>;
}

function opensSubNode(a: AffLike): boolean {
  return a.kind === 'reveal' && Array.isArray(a.children) && a.children.length > 0;
}

/** Walk every state's affordance tree and synthesise the reveal sub-nodes. */
export function synthesizeRevealSubNodes(states: StateLike[]): RevealSynthesis {
  const subStates: SubState[] = [];
  const revealEdges: LayoutEdge[] = [];
  const childOwner = new Map<string, string>();
  let revSeq = 0;

  const harvest = (ownerId: string, role: string, affs: AffLike[] | undefined): void => {
    for (const a of affs ?? []) {
      if (opensSubNode(a)) {
        const subId = ownerId + '::' + a.id;
        const children = a.children as AffLike[];
        subStates.push({ id: subId, semanticName: a.label, role,
          availableSignals: [], affordances: children, parent: ownerId });
        revealEdges.push({ id: `rev${revSeq++}`, source: ownerId, target: subId,
          fork: false, viaAffordance: a.id, label: a.label, reveal: true });
        for (const c of children) childOwner.set(c.id, subId);
        // nested overlay: a child that is itself a reveal-with-children.
        harvest(subId, role, children);
      }
    }
  };
  for (const s of states) harvest(s.id, s.role, s.affordances);

  return { subStates, revealEdges, childOwner };
}

/** Build the LayoutNode list: real states + synthetic reveal sub-nodes. */
export function buildLayoutNodes(states: StateLike[], subStates: SubState[]): LayoutNode[] {
  return [
    // reveal children now live in their own sub-node, so they no longer inflate the
    // parent's height estimate — count only top-level affordances.
    ...states.map((s) => ({ id: s.id, label: s.semanticName, badges: s.affordances?.length ?? 0 })),
    ...subStates.map((s) => ({ id: s.id, label: s.semanticName, badges: s.affordances.length,
      sub: true, subParent: s.parent })),
  ];
}

/** Build the LayoutEdge list: interior edges (child edges re-pointed to their
 *  sub-node) + the synthetic reveal edges. */
export function buildLayoutEdges(
  edges: InteriorEdgeLike[], revealEdges: LayoutEdge[], childOwner: Map<string, string>,
  isFork: (e: InteriorEdgeLike) => boolean,
): LayoutEdge[] {
  return [
    ...edges.map((e, i) => ({
      id: `e${i}`,
      // a child-of-reveal edge is emitted as {from:S, viaAffordance:childId};
      // re-point its source to the SUB-NODE that now owns that child.
      source: (e.viaAffordance && childOwner.get(e.viaAffordance)) || e.from,
      target: e.to,
      fork: isFork(e),
      core: e.core === true,
      viaAffordance: e.viaAffordance,
      dangling: e.dangling === true,
      label: e.semanticStep,
    })),
    ...revealEdges,
  ];
}
