import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';

function scripted(pages: string[]): WalkBrowser {
  let idx = 0;
  return { async snapshot() { return pages[idx]; }, async act() { idx++; }, callCount() { return idx; } };
}
function setup() {
  const store = MapStore.fromDatabase(new Database(':memory:'));
  for (const id of ['a', 'b']) store.upsertState(makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail', fingerprint: [`link:on-${id}`] }));
  return store;
}

describe('walkRoute — requiresAffordances pause', () => {
  it('pauses (needs-navigation listing the affordances) BEFORE traversing a gated edge', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'open cart', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "on-a" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
    });
    expect(res.status).toBe('needs-navigation');
    expect((res as any).question).toContain('add an item to the cart');
  });

  it('does NOT pause for an edge with no requiresAffordances (autopilot preserved)', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'follow "to-b"', kind: 'navigate' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "to-b" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
    });
    expect(res.status).toBe('done');
  });

  it('on resume (answer present), proceeds past the gated edge', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'open cart', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "on-a" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
      answer: { kind: 'ref', ref: 'e1' },
    });
    expect(res.status).toBe('done');
  });

  it('a commit-point edge HALTS by default (needs-classification), never auto-fired', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Finish"', kind: 'commit-point' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- button "Finish" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
    });
    expect(res.status).toBe('needs-classification');
    if (res.status === 'needs-classification') expect(res.action).toMatch(/Finish/);
  });

  it('on resume with verdict "safe", FIRES the commit edge and reaches the goal (R5)', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Finish"', kind: 'commit-point' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- button "Finish" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
      answer: { kind: 'classify', verdict: 'safe' },
    });
    // classified safe → the agent took responsibility → the commit is fired and we
    // reach b (previously this re-escalated forever — the resume bug).
    expect(res.status).toBe('done');
  });

  it('on resume with verdict "commit", HARD-HALTS without firing (principle #2)', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Finish"', kind: 'commit-point' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- button "Finish" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
      answer: { kind: 'classify', verdict: 'commit' },
    });
    expect(res.status).toBe('done');     // halted-done, did NOT advance to b
    if (res.status === 'done') expect((res as { halted?: string }).halted).toBe('commit-point');
  });
});
