import { describe, it, expect } from 'vitest';
import { type State, type Goal, makeEdge, makeState } from '../../src/mapstore/types.js';

describe('core types', () => {
  it('makeEdge sets sane defaults', () => {
    const e = makeEdge({
      fromState: 's1', toState: 's2',
      semanticStep: 'open the Insights tab', kind: 'navigate',
    });
    expect(e.cost).toBe(0);
    expect(e.core).toBe(false);
    expect(e.requiresAffordances).toEqual([]);
    expect(e.selectorCache).toBeNull();
    expect(e.acceptsInput).toBeNull();
  });

  it('State and Goal shapes compile with required fields', () => {
    const s: State = {
      id: 'github:repo-detail', nodeId: 'github.com', semanticName: 'github:repo-detail',
      urlPattern: 'github.com/*/*', role: 'detail',
      availableSignals: ['stars', 'license'], fingerprint: ['heading', 'star-count'],
    };
    const g: Goal = {
      name: 'github-repos', site: null, entry: null, extractor: null,
      visit: ['detail'], surface: { detail: ['stars', 'license'] }, candidateLimit: 10,
    };
    expect(s.role).toBe('detail');
    expect(g.candidateLimit).toBe(10);
  });
});

describe('makeState', () => {
  it('builds a State with explicit fields and defaults empty arrays', () => {
    const s = makeState({ id: 'github:search-entry', nodeId: 'github.com',
      semanticName: 'github:search-entry', urlPattern: 'https://github.com/search*',
      role: 'search-entry' });
    expect(s.nodeId).toBe('github.com');
    expect(s.availableSignals).toEqual([]);
    expect(s.fingerprint).toEqual([]);
  });

  it('keeps provided signals/fingerprint', () => {
    const s = makeState({ id: 'github:repo-detail', nodeId: 'github.com',
      semanticName: 'github:repo-detail', urlPattern: 'https://github.com/*/*',
      role: 'detail', availableSignals: ['stars'], fingerprint: ['heading'] });
    expect(s.availableSignals).toEqual(['stars']);
    expect(s.fingerprint).toEqual(['heading']);
  });
});
