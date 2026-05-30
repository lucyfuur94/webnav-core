import { describe, it, expect } from 'vitest';
import { FIND_BATTLE_TESTED_REPOS } from '../../src/goals/find-battle-tested-repos.js';

describe('find-battle-tested-repos goal', () => {
  it('visits the detail state and surfaces quality signals', () => {
    const g = FIND_BATTLE_TESTED_REPOS;
    expect(g.name).toBe('find-battle-tested-repos');
    expect(g.visit).toContain('detail');
    expect(g.surface.detail).toEqual(
      expect.arrayContaining(['stars', 'last_commit', 'open_issues', 'license']));
    expect(g.candidateLimit).toBe(10);
  });
});
