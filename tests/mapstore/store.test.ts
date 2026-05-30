import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeEdge } from '../../src/mapstore/types.js';

function freshStore() { return new MapStore(':memory:'); }

describe('MapStore', () => {
  it('upserts and retrieves a state', () => {
    const s = freshStore();
    s.upsertState({ id: 'a', semanticName: 'a', urlPattern: 'x', role: 'detail',
      availableSignals: ['stars'], fingerprint: ['heading'] });
    expect(s.getState('a')?.availableSignals).toEqual(['stars']);
  });

  it('upserts an edge and finds it by fromState', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate' }));
    expect(s.edgesFrom('a')).toHaveLength(1);
  });

  it('record_outcome updates reliability', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate' }));
    s.recordOutcome('a', 'b', 'go', true);
    s.recordOutcome('a', 'b', 'go', false);
    const e = s.edgesFrom('a')[0];
    expect(e.successCount).toBe(1);
    expect(e.failCount).toBe(1);
    expect(e.reliability).toBeCloseTo(0.5);
    expect(e.lastVerified).not.toBeNull();
  });

  it('decayConfidence lowers confidence for old edges', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate',
      lastVerified: 1, confidence: 1 }));
    s.decayConfidence(1000 * 60 * 60 * 24 * 30); // 30 days later, halfLife default
    expect(s.edgesFrom('a')[0].confidence).toBeLessThan(1);
  });

  it('stores and retrieves a goal', () => {
    const s = freshStore();
    s.upsertGoal({ name: 'g', visit: ['detail'], surface: { detail: ['stars'] }, candidateLimit: 5 });
    expect(s.getGoal('g')?.candidateLimit).toBe(5);
  });
});
