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

  it('edgesFrom projects _shell navigate affordances as from-anywhere edges', () => {
    const s = store();
    s.upsertState(makeState({ id: 'x.test:_shell', nodeId: 'x.test', semanticName: '_shell', urlPattern: 'https://x.test', role: 'shell', fingerprint: [],
      affordances: [makeAffordance({ id: 'a1', label: 'Reports', kind: 'navigate', toState: 'x.test:report-list' })] }));
    s.upsertState(makeState({ id: 'x.test:report-list', nodeId: 'x.test', semanticName: 'report-list', urlPattern: 'https://x.test/report/list', role: 'section', fingerprint: ['heading:Reports'] }));
    s.upsertState(makeState({ id: 'x.test:downloads', nodeId: 'x.test', semanticName: 'downloads', urlPattern: 'https://x.test/download/list', role: 'section', fingerprint: ['heading:Downloads'] }));
    const edges = s.edgesFrom('x.test:downloads');
    expect(edges.some((e) => e.toState === 'x.test:report-list' && e.fromState === 'x.test:downloads')).toBe(true);
  });

  it('does not duplicate a shell edge when the state already has its own edge to the same target', () => {
    const s = store();
    s.upsertState(makeState({ id: 'x.test:_shell', nodeId: 'x.test', semanticName: '_shell', urlPattern: 'https://x.test', role: 'shell', fingerprint: [],
      affordances: [makeAffordance({ id: 'a1', label: 'Reports', kind: 'navigate', toState: 'x.test:report-list' })] }));
    s.upsertState(makeState({ id: 'x.test:report-list', nodeId: 'x.test', semanticName: 'report-list', urlPattern: '', role: 'section' }));
    s.upsertState(makeState({ id: 'x.test:downloads', nodeId: 'x.test', semanticName: 'downloads', urlPattern: '', role: 'section',
      affordances: [makeAffordance({ id: 'a2', label: 'Reports', kind: 'navigate', toState: 'x.test:report-list' })] }));
    const edges = s.edgesFrom('x.test:downloads');
    expect(edges.filter((e) => e.toState === 'x.test:report-list')).toHaveLength(1);
  });

  it('a state\'s OWN edges do not get shell edges projected onto the shell record itself', () => {
    const s = store();
    s.upsertState(makeState({ id: 'x.test:_shell', nodeId: 'x.test', semanticName: '_shell', urlPattern: 'https://x.test', role: 'shell', fingerprint: [],
      affordances: [makeAffordance({ id: 'a1', label: 'Reports', kind: 'navigate', toState: 'x.test:report-list' })] }));
    s.upsertState(makeState({ id: 'x.test:report-list', nodeId: 'x.test', semanticName: 'report-list', urlPattern: '', role: 'section' }));
    // edgesFrom('_shell') should return exactly ONE edge (its own), not doubled by the shell-projection.
    expect(s.edgesFrom('x.test:_shell')).toHaveLength(1);
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
