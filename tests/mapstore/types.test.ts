import { describe, it, expect } from 'vitest';
import { type State, type Edge, type Goal, makeEdge } from '../../src/mapstore/types.js';

describe('core types', () => {
  it('makeEdge sets sane defaults', () => {
    const e = makeEdge({
      fromState: 's1', toState: 's2',
      semanticStep: 'open the Insights tab', kind: 'navigate',
    });
    expect(e.reliability).toBe(1);
    expect(e.successCount).toBe(0);
    expect(e.failCount).toBe(0);
    expect(e.confidence).toBe(1);
    expect(e.selectorCache).toBeNull();
    expect(e.acceptsInput).toBeNull();
  });

  it('State and Goal shapes compile with required fields', () => {
    const s: State = {
      id: 'github:repo-detail', semanticName: 'github:repo-detail',
      urlPattern: 'github.com/*/*', role: 'detail',
      availableSignals: ['stars', 'license'], fingerprint: ['heading', 'star-count'],
    };
    const g: Goal = {
      name: 'find-battle-tested-repos', visit: ['detail'],
      surface: { detail: ['stars', 'license'] }, candidateLimit: 10,
    };
    expect(s.role).toBe('detail');
    expect(g.candidateLimit).toBe(10);
  });
});
