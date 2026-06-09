import { describe, it, expect } from 'vitest';
import { isForkEdge } from './forkEdge.js';

describe('isForkEdge', () => {
  it('flags an unclassified edge', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'click Sign in', kind: 'unclassified', core: false, viaAffordance: 'aff_signin' })).toBe(true);
  });
  it('flags a needs-input step regardless of kind', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'do x [needs-input: creds]', kind: 'navigate', core: false, viaAffordance: 'aff_x' })).toBe(true);
  });
  it('does not flag a plain navigate edge', () => {
    expect(isForkEdge({ from: 'a', to: 'b', semanticStep: 'follow a result link', kind: 'navigate', core: false, viaAffordance: 'aff_link' })).toBe(false);
  });
});
