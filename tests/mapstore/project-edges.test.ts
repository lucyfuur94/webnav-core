import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeAffordance, makeEdge } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('edge projection from affordances', () => {
  it('projects a navigate affordance into an edge (no stored edge needed)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_cart', label: 'open the shopping cart', kind: 'navigate',
        toState: 'sd:cart', needs: ['aff_add'] })] }));
    const edges = s.edgesFrom('sd:inv');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromState: 'sd:inv', toState: 'sd:cart', kind: 'navigate',
      semanticStep: 'open the shopping cart', requiresAffordances: ['aff_add'] });
  });

  it('projects reveal children that navigate, but never mutate/input', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [
        makeAffordance({ id: 'aff_sort', label: 'sort products', kind: 'mutate' }),
        makeAffordance({ id: 'aff_add', label: 'add to cart', kind: 'mutate' }),
        makeAffordance({ id: 'aff_menu', label: 'open menu', kind: 'reveal', children: [
          makeAffordance({ id: 'aff_logout', label: 'Logout', kind: 'navigate', toState: 'sd:login' }),
          makeAffordance({ id: 'aff_about', label: 'About', kind: 'navigate', toState: null }), // unexplored
        ] }),
      ] }));
    const edges = s.edgesFrom('sd:inv');
    // Only the explored navigate child projects; mutate + unexplored do not.
    expect(edges.map((e) => e.toState)).toEqual(['sd:login']);
  });

  it('a commit-flagged navigate projects as a commit-point edge', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:over', nodeId: 'sd', semanticName: 'over', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_finish', label: 'click Finish', kind: 'navigate',
        toState: 'sd:complete', commit: true })] }));
    expect(s.edgesFrom('sd:over')[0].kind).toBe('commit-point');
  });

  it('stored edge wins over a duplicate projected edge (carries the self-heal selector cache)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_cart', label: 'open cart', kind: 'navigate', toState: 'sd:cart' })] }));
    s.upsertState(makeState({ id: 'sd:cart', nodeId: 'sd', semanticName: 'cart', urlPattern: '', role: 'detail' }));
    // a self-heal repair lands on the STORED row; the duplicate projection must not shadow it
    s.upsertEdge(makeEdge({ fromState: 'sd:inv', toState: 'sd:cart', semanticStep: 'open cart', kind: 'navigate' }));
    s.recordSelector('sd:inv', 'sd:cart', 'open cart', 'Shopping cart');
    const edges = s.edgesFrom('sd:inv');
    expect(edges).toHaveLength(1); // not duplicated
    expect(edges[0].selectorCache).toBe('Shopping cart'); // the stored row (with the repair) won
  });
});
