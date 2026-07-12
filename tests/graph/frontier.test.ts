import { describe, it, expect } from 'vitest';
import { computeFrontier } from '../../src/graph/frontier.js';
import { makeState, makeAffordance } from '../../src/mapstore/types.js';
import type { State } from '../../src/mapstore/types.js';

const st = (id: string, affs: State['affordances']): State =>
  makeState({ id, nodeId: 'x', semanticName: id, urlPattern: '', role: 'detail', affordances: affs });

describe('computeFrontier — kinds', () => {
  it('dangling navigate (toState null) → frontier (dangling-target)', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'n', label: 'Go somewhere', kind: 'navigate', toState: null }),
    ])]);
    expect(f.total).toBe(1);
    expect(f.frontier[0]).toMatchObject({ state: 'x:a', kind: 'navigate', reason: 'dangling-target' });
  });

  it('resolved navigate (toState set) → NOT frontier', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'n', label: 'Reports', kind: 'navigate', toState: 'x:reports' }),
    ])]);
    expect(f.total).toBe(0);
  });

  it('reveal WITH children → NOT frontier', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'r', label: 'Open menu', kind: 'reveal', children: [
        makeAffordance({ id: 'c', label: 'Logout', kind: 'navigate', toState: 'x:login' }),
      ] }),
    ])]);
    expect(f.total).toBe(0);
  });

  it('reveal WITHOUT children → frontier (unopened-panel)', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'r', label: 'Date range', kind: 'reveal', children: null }),
    ])]);
    expect(f.total).toBe(1);
    expect(f.frontier[0]).toMatchObject({ kind: 'reveal', reason: 'unopened-panel' });
  });

  it('switcher-shaped mutate → ambiguous-action frontier (the the analytics SPA account/model switcher)', () => {
    const f = computeFrontier('x', [st('x:_shell', [
      makeAffordance({ id: 'sw', label: 'O Overview Merged Change', kind: 'mutate' }),
    ])]);
    expect(f.total).toBe(1);
    expect(f.frontier[0]).toMatchObject({ kind: 'mutate', reason: 'ambiguous-action' });
  });

  it('sort / refresh / pagination / toggle mutates → NOT frontier (in-place shapes)', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'm1', label: 'Sort by name', kind: 'mutate' }),
      makeAffordance({ id: 'm2', label: 'Refresh list', kind: 'mutate' }),
      makeAffordance({ id: 'm3', label: 'Next Page', kind: 'mutate' }),
      makeAffordance({ id: 'm4', label: 'Page Size', kind: 'mutate' }),
      makeAffordance({ id: 'm5', label: 'Press Space to toggle row selection (unchecked)', kind: 'input' }),
      makeAffordance({ id: 'm6', label: 'Dark Mode', kind: 'mutate' }),
    ])]);
    expect(f.total).toBe(0);
  });

  it('scope row/widget templates → NOT frontier (already generalized)', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'row', label: 'Some ambiguous row action', kind: 'mutate', scope: 'row' }),
      makeAffordance({ id: 'w', label: 'A widget', kind: 'mutate', scope: 'widget' }),
    ])]);
    expect(f.total).toBe(0);
  });
});

describe('computeFrontier — exclusions', () => {
  it('--exclude label moves the item to excluded[] (visible, off the worklist)', () => {
    const f = computeFrontier('x', [st('x:_shell', [
      makeAffordance({ id: 'sw', label: 'O Overview Merged Change', kind: 'mutate' }),
      makeAffordance({ id: 'classic', label: 'Switch to Classic', kind: 'mutate' }),
    ])], ['Switch to Classic']);
    expect(f.total).toBe(1);
    expect(f.frontier.map((i) => i.label)).toEqual(['O Overview Merged Change']);
    expect(f.excluded.map((i) => i.label)).toEqual(['Switch to Classic']);
  });

  it('exclusion match is case-insensitive substring', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'a', label: 'Admin Panel', kind: 'mutate' }),
    ])], ['admin']);
    expect(f.total).toBe(0);
    expect(f.excluded).toHaveLength(1);
  });
});

describe('computeFrontier — byState + empty', () => {
  it('counts frontier items per owning state (excluded not counted)', () => {
    const f = computeFrontier('x', [
      st('x:a', [makeAffordance({ id: 'n', label: 'Go', kind: 'navigate', toState: null })]),
      st('x:b', [
        makeAffordance({ id: 'r', label: 'Panel', kind: 'reveal', children: null }),
        makeAffordance({ id: 'm', label: 'Mystery button', kind: 'mutate' }),
      ]),
    ]);
    expect(f.byState).toEqual({ 'x:a': 1, 'x:b': 2 });
  });

  it('fully-explored map → empty frontier (drives exit 0)', () => {
    const f = computeFrontier('x', [st('x:a', [
      makeAffordance({ id: 'n', label: 'Reports', kind: 'navigate', toState: 'x:reports' }),
      makeAffordance({ id: 's', label: 'Sort', kind: 'mutate' }),
    ])]);
    expect(f.total).toBe(0);
    expect(f.frontier).toHaveLength(0);
  });
});
