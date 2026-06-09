import { describe, it, expect } from 'vitest';
import {
  synthesizeRevealSubNodes, buildLayoutNodes, buildLayoutEdges,
  type StateLike, type InteriorEdgeLike,
} from './revealSubnodes.js';

// A saucedemo-shaped inventory state: a reveal "open the burger menu" with four
// children (All Items → inventory, About → unexplored, Logout → login, Reset →
// mutate). The API projects each child edge as {from: inventory, viaAffordance:
// childId} — so the viewer must re-point those to leave the SUB-NODE.
function inventoryState(): StateLike {
  return {
    id: 'sd:inventory', semanticName: 'inventory', role: 'list', availableSignals: [],
    affordances: [
      { id: 'aff_cart', label: 'open the cart', kind: 'navigate', children: null },
      {
        id: 'aff_burger', label: 'open the burger menu', kind: 'reveal',
        children: [
          { id: 'aff_all', label: 'All Items', kind: 'navigate', children: null },
          { id: 'aff_about', label: 'About', kind: 'navigate', children: null },
          { id: 'aff_logout', label: 'Logout', kind: 'navigate', children: null },
          { id: 'aff_reset', label: 'Reset App State', kind: 'mutate', children: null },
        ],
      },
    ],
  };
}

const F = (_e: InteriorEdgeLike) => false; // no forks in these fixtures
// expand the burger overlay (the new collapse-by-default gate is opened for tests
// that assert on the materialised sub-node).
const EXPAND_ALL = () => true;

describe('reveal sub-node synthesis (viewer-only)', () => {
  it('materialises a sub-node + a parent→sub reveal edge, child edges leave the sub-node (when expanded)', () => {
    const states = [inventoryState()];
    const edges: InteriorEdgeLike[] = [
      { from: 'sd:inventory', to: 'sd:cart', semanticStep: 'open the cart', kind: 'navigate', viaAffordance: 'aff_cart', core: false },
      { from: 'sd:inventory', to: 'sd:inventory', semanticStep: 'All Items', kind: 'navigate', viaAffordance: 'aff_all', core: false },
      { from: 'sd:inventory', to: null, semanticStep: 'About', kind: 'navigate', viaAffordance: 'aff_about', core: false, dangling: true },
      { from: 'sd:inventory', to: 'sd:login', semanticStep: 'Logout', kind: 'navigate', viaAffordance: 'aff_logout', core: false },
    ];

    const { subStates, revealEdges, childOwner, overlayChildIds } = synthesizeRevealSubNodes(states, EXPAND_ALL);

    // exactly one sub-node, holding the overlay's options
    expect(subStates).toHaveLength(1);
    const sub = subStates[0];
    expect(sub.id).toBe('sd:inventory::aff_burger');
    expect(sub.parent).toBe('sd:inventory');
    expect(sub.semanticName).toBe('open the burger menu');
    expect(sub.affordances.map((a) => a.id)).toEqual(['aff_all', 'aff_about', 'aff_logout', 'aff_reset']);

    // a parent→sub reveal edge, anchored to the burger affordance, styled 'reveal'
    expect(revealEdges).toHaveLength(1);
    expect(revealEdges[0].source).toBe('sd:inventory');
    expect(revealEdges[0].target).toBe('sd:inventory::aff_burger');
    expect(revealEdges[0].viaAffordance).toBe('aff_burger');
    expect(revealEdges[0].reveal).toBe(true);

    // each overlay child is owned by the sub-node
    for (const id of ['aff_all', 'aff_about', 'aff_logout', 'aff_reset']) {
      expect(childOwner.get(id)).toBe('sd:inventory::aff_burger');
    }

    const le = buildLayoutEdges(edges, revealEdges, childOwner, F, overlayChildIds);
    const byVia = (v: string) => le.find((e) => e.viaAffordance === v)!;
    // cart edge is a TOP-LEVEL affordance — stays sourced from inventory
    expect(byVia('aff_cart').source).toBe('sd:inventory');
    // overlay children — re-pointed to leave the SUB-NODE, not inventory
    expect(byVia('aff_all').source).toBe('sd:inventory::aff_burger');
    expect(byVia('aff_all').target).toBe('sd:inventory'); // All Items → inventory
    expect(byVia('aff_logout').source).toBe('sd:inventory::aff_burger');
    expect(byVia('aff_logout').target).toBe('sd:login');  // Logout → login
    // About has no toState → still a dangling stub, now FROM the sub-node
    expect(byVia('aff_about').source).toBe('sd:inventory::aff_burger');
    expect(byVia('aff_about').target).toBeNull();
    expect(byVia('aff_about').dangling).toBe(true);
    // plus the reveal edge itself
    expect(le.some((e) => e.reveal)).toBe(true);
  });

  it('parent node no longer counts reveal children in its badge/height estimate', () => {
    const { subStates } = synthesizeRevealSubNodes([inventoryState()], EXPAND_ALL);
    const ln = buildLayoutNodes([inventoryState()], subStates);
    const parent = ln.find((n) => n.id === 'sd:inventory')!;
    const sub = ln.find((n) => n.id === 'sd:inventory::aff_burger')!;
    // parent has 2 top-level affordances (cart + burger) — NOT 2 + 4 children
    expect(parent.badges).toBe(2);
    expect(sub.sub).toBe(true);
    expect(sub.subParent).toBe('sd:inventory');
    expect(sub.badges).toBe(4);
  });

  it('recurses nested overlays (a reveal child that itself has children)', () => {
    const states: StateLike[] = [{
      id: 's', semanticName: 's', role: 'page', availableSignals: [],
      affordances: [{
        id: 'r1', label: 'outer', kind: 'reveal',
        children: [{
          id: 'r2', label: 'inner', kind: 'reveal',
          children: [{ id: 'leaf', label: 'leaf', kind: 'navigate', children: null }],
        }],
      }],
    }];
    const { subStates, revealEdges } = synthesizeRevealSubNodes(states, EXPAND_ALL);
    expect(subStates.map((s) => s.id).sort()).toEqual(['s::r1', 's::r1::r2'].sort());
    // outer → its sub-node, and the inner reveal (now living in s::r1) → its sub-node
    expect(revealEdges.some((e) => e.source === 's' && e.target === 's::r1')).toBe(true);
    expect(revealEdges.some((e) => e.source === 's::r1' && e.target === 's::r1::r2')).toBe(true);
  });

  it('COLLAPSES overlays by default: no sub-node, no reveal edge, child edges dropped', () => {
    const states = [inventoryState()];
    const edges: InteriorEdgeLike[] = [
      // a TOP-LEVEL affordance edge — always kept
      { from: 'sd:inventory', to: 'sd:cart', semanticStep: 'open the cart', kind: 'navigate', viaAffordance: 'aff_cart', core: true },
      // overlay child edges — dropped while the burger menu is collapsed
      { from: 'sd:inventory', to: 'sd:login', semanticStep: 'Logout', kind: 'navigate', viaAffordance: 'aff_logout', core: false },
      { from: 'sd:inventory', to: 'sd:inventory', semanticStep: 'All Items', kind: 'navigate', viaAffordance: 'aff_all', core: false },
    ];
    // default predicate = everything collapsed
    const { subStates, revealEdges, childOwner, overlayChildIds } = synthesizeRevealSubNodes(states);
    expect(subStates).toHaveLength(0);
    expect(revealEdges).toHaveLength(0);
    // overlayChildIds still enumerates the overlay's children (so edges can be dropped)
    expect(overlayChildIds.has('aff_logout')).toBe(true);

    const le = buildLayoutEdges(edges, revealEdges, childOwner, F, overlayChildIds);
    // the top-level cart edge survives; the two collapsed overlay child edges are gone
    expect(le.some((e) => e.viaAffordance === 'aff_cart')).toBe(true);
    expect(le.some((e) => e.viaAffordance === 'aff_logout')).toBe(false);
    expect(le.some((e) => e.viaAffordance === 'aff_all')).toBe(false);
  });

  it('expands ONLY the toggled overlay (per-state scoped predicate)', () => {
    const states = [inventoryState()];
    const isExpanded = (owner: string, aff: string) => owner === 'sd:inventory' && aff === 'aff_burger';
    const { subStates } = synthesizeRevealSubNodes(states, isExpanded);
    expect(subStates.map((s) => s.id)).toEqual(['sd:inventory::aff_burger']);
  });
});
