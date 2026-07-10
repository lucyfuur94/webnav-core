import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge, makeAffordance } from '../../src/mapstore/types.js';
import { findPath } from '../../src/router/path.js';

function store(): MapStore {
  return MapStore.fromDatabase(new Database(':memory:'));
}
function addState(s: MapStore, id: string) {
  s.upsertState(makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail' }));
}
function addEdge(s: MapStore, from: string, to: string, extra: Partial<{ cost: number }> = {}) {
  s.upsertEdge(makeEdge({ fromState: from, toState: to, semanticStep: `${from}->${to}`, kind: 'navigate', ...extra }));
}

describe('findPath', () => {
  it('finds a linear path', () => {
    const s = store();
    ['a', 'b', 'c'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b'); addEdge(s, 'b', 'c');
    expect(findPath(s, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('returns [start] when start === goal', () => {
    const s = store(); addState(s, 'a');
    expect(findPath(s, 'a', 'a')).toEqual(['a']);
  });

  it('picks the lower-cost branch', () => {
    const s = store();
    ['a', 'b', 'c', 'd'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b');
    addEdge(s, 'b', 'd');
    addEdge(s, 'a', 'c', { cost: 5 });
    addEdge(s, 'c', 'd', { cost: 5 });
    expect(findPath(s, 'a', 'd')).toEqual(['a', 'b', 'd']);
  });

  it('returns null when unreachable', () => {
    const s = store();
    ['a', 'b', 'x'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b');
    expect(findPath(s, 'a', 'x')).toBeNull();
  });

  it('terminates on a cycle', () => {
    const s = store();
    ['a', 'b'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b'); addEdge(s, 'b', 'a');
    expect(findPath(s, 'a', 'b')).toEqual(['a', 'b']);
    expect(findPath(s, 'b', 'a')).toEqual(['b', 'a']);
  });

  it('crosses a shell edge: a page with no own edges still reaches a target via _shell', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:_shell', nodeId: 'n', semanticName: '_shell', urlPattern: 'https://n.example', role: 'shell', fingerprint: [],
      affordances: [makeAffordance({ id: 'a1', label: 'Reports', kind: 'navigate', toState: 'n:report-list' })] }));
    addState(s, 'n:report-list');
    addState(s, 'n:downloads');   // NO own edges — only reachable to report-list via the shell
    expect(findPath(s, 'n:downloads', 'n:report-list')).toEqual(['n:downloads', 'n:report-list']);
  });
});
