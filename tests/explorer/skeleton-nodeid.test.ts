import { describe, it, expect } from 'vitest';
import { GITHUB_SKELETON } from '../../src/explorer/github-skeleton.js';
import { SAUCEDEMO_SKELETON } from '../../src/explorer/saucedemo-skeleton.js';

describe('skeleton states carry nodeId', () => {
  it('every GitHub state is owned by github.com', () => {
    expect(GITHUB_SKELETON.states.length).toBeGreaterThan(0);
    for (const s of GITHUB_SKELETON.states) expect(s.nodeId).toBe('github.com');
  });
  it('every saucedemo state is owned by saucedemo', () => {
    expect(SAUCEDEMO_SKELETON.states.length).toBeGreaterThan(0);
    for (const s of SAUCEDEMO_SKELETON.states) expect(s.nodeId).toBe('saucedemo');
  });
});
