import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';

// Scripted browser: snapshot() returns pages[idx]; act() advances idx.
function scripted(pages: string[]): WalkBrowser {
  let idx = 0;
  return {
    async snapshot() { return pages[idx]; },
    async act() { idx++; },
    callCount() { return idx; },
  };
}

describe('walkRoute path-following', () => {
  it('follows the resolved path a->c->goal (not the a->b edges[0])', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    for (const id of ['a', 'b', 'c', 'goal']) {
      // fingerprint = a unique link token per state so matchState is unambiguous
      store.upsertState(makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail',
        fingerprint: [`link:on-${id}`] }));
    }
    // a has TWO outgoing edges; edges[0] is a->b (wrong). The path forces a->c.
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'follow "to-b"', kind: 'navigate' }));
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'c', semanticStep: 'follow "to-c"', kind: 'navigate' }));
    store.upsertEdge(makeEdge({ fromState: 'c', toState: 'goal', semanticStep: 'follow "to-goal"', kind: 'navigate' }));
    const states = store.allStates();

    // Pages observed in order: start on a (declares link "to-c"); after act -> c
    // (must match c.fingerprint link:on-c AND declare link "to-goal"); after act ->
    // goal (must match goal.fingerprint link:on-goal).
    const pages = [
      '- link "to-c" [ref=e1]\n- link "on-a" [ref=e0]',
      '- link "on-c" [ref=e2]\n- link "to-goal" [ref=e3]',
      '- link "on-goal" [ref=e4]',
    ];
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'goal',
      store, states, browser: scripted(pages), path: ['a', 'c', 'goal'],
    });
    expect(res.status).toBe('done');
  });

  it('classify=commit halts without acting', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    store.upsertState(makeState({ id: 'x', nodeId: 'n', semanticName: 'x', urlPattern: '', role: 'detail', fingerprint: ['link:on-x'] }));
    store.upsertState(makeState({ id: 'y', nodeId: 'n', semanticName: 'y', urlPattern: '', role: 'detail', fingerprint: ['link:on-y'] }));
    store.upsertEdge(makeEdge({ fromState: 'x', toState: 'y', semanticStep: 'click "Finish"', kind: 'unclassified' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'x', goalStateId: 'y', store, states: store.allStates(),
      browser: scripted(['- link "on-x" [ref=e1]']), path: ['x', 'y'],
      answer: { kind: 'classify', verdict: 'commit' },
    });
    expect(res.status).toBe('done');
    expect((res as any).halted).toBe('commit-point');
  });
});
