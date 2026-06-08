import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeAffordance } from '../../src/mapstore/types.js';
import { buildNodeInterior } from '../../src/graph/interior.js';

describe('buildNodeInterior — affordance tree + dangling stubs', () => {
  it('exposes the typed affordance tree and a dangling edge for an unexplored child', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    store.upsertNode({ id: 'sd', homeUrl: 'https://www.saucedemo.com', capabilities: [], topics: [] });
    store.upsertState(makeState({ id: 'sd:inventory', nodeId: 'sd', semanticName: 'inventory', urlPattern: '*inventory*', role: 'detail',
      affordances: [
        makeAffordance({ id: 'aff_cart', label: 'open the shopping cart', kind: 'navigate', toState: 'sd:cart' }),
        makeAffordance({ id: 'aff_sort', label: 'sort products', kind: 'mutate' }),
        makeAffordance({ id: 'aff_menu', label: 'open menu', kind: 'reveal', children: [
          makeAffordance({ id: 'aff_about', label: 'About', kind: 'navigate', toState: null }),
          makeAffordance({ id: 'aff_logout', label: 'Logout', kind: 'navigate', toState: 'sd:login' }),
        ] }),
      ] }));
    store.upsertState(makeState({ id: 'sd:cart', nodeId: 'sd', semanticName: 'cart', urlPattern: '*cart*', role: 'detail' }));
    store.upsertState(makeState({ id: 'sd:login', nodeId: 'sd', semanticName: 'login', urlPattern: '', role: 'detail' }));

    const iv = buildNodeInterior(store, 'sd');
    const inv = iv.states.find((s) => s.id === 'sd:inventory')!;
    // Full typed tree, including reveal children.
    expect(inv.affordances.find((a) => a.kind === 'reveal')!.children!.map((c) => c.label))
      .toEqual(['About', 'Logout']);

    // The unexplored "About" child surfaces as a dangling edge anchored to its affordance.
    const dangling = iv.edges.find((e) => e.viaAffordance === 'aff_about')!;
    expect(dangling.dangling).toBe(true);
    expect(dangling.to).toBeNull();

    // Explored edges carry viaAffordance for anchoring.
    const cart = iv.edges.find((e) => e.to === 'sd:cart')!;
    expect(cart.viaAffordance).toBe('aff_cart');
    const logout = iv.edges.find((e) => e.to === 'sd:login')!;
    expect(logout.viaAffordance).toBe('aff_logout');

    // mutate never becomes an edge.
    expect(iv.edges.some((e) => e.viaAffordance === 'aff_sort')).toBe(false);
  });
});
