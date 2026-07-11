import { describe, it, expect } from 'vitest';
import { matchState } from '../../src/explorer/fingerprint.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import type { State } from '../../src/mapstore/types.js';

const states: State[] = [
  { id: 'search', semanticName: 'search', urlPattern: '*', role: 'search-entry',
    availableSignals: [], fingerprint: ['searchbox'] },
  { id: 'detail', semanticName: 'detail', urlPattern: '*', role: 'detail',
    availableSignals: [], fingerprint: ['heading', 'button:Star'] },
];

describe('matchState', () => {
  it('matches a unique state by fingerprint tokens', () => {
    const nodes = parseSnapshot('- searchbox "Search" [ref=e1]');
    expect(matchState(nodes, states)).toEqual({ status: 'matched', state: states[0] });
  });
  it('reports none when nothing matches', () => {
    const nodes = parseSnapshot('- paragraph "hello"');
    expect(matchState(nodes, states).status).toBe('none');
  });
  it('reports ambiguous when multiple match', () => {
    const dup = [...states, { ...states[0], id: 'search2' }];
    const nodes = parseSnapshot('- searchbox "Search" [ref=e1]');
    expect(matchState(nodes, dup).status).toBe('ambiguous');
  });
  it('a state with an EMPTY fingerprint is never a match candidate (matched or ambiguous)', () => {
    // `[].every()` is vacuously true — without the guard an empty-fp state (`_shell`, a degenerate
    // stub) matches EVERY page: live finding, a walk arriving at a real state escalated
    // `ambiguous:[state,_shell]` forever.
    const shell: State = { id: '_shell', semanticName: '_shell', urlPattern: '*', role: 'shell',
      availableSignals: [], fingerprint: [] };
    const nodes = parseSnapshot('- searchbox "Search" [ref=e1]');
    // alongside a real match → still uniquely matched, never ambiguous-with-_shell
    expect(matchState(nodes, [...states, shell])).toEqual({ status: 'matched', state: states[0] });
    // alone → none, not matched-on-nothing
    expect(matchState(nodes, [shell]).status).toBe('none');
  });
});
