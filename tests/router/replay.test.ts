import { describe, it, expect } from 'vitest';
import { replayStep } from '../../src/router/replay.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { makeEdge } from '../../src/mapstore/types.js';

describe('replayStep (deterministic, zero LLM)', () => {
  it('uses cached selector when still present', () => {
    const nodes = parseSnapshot('- button "Go" [ref=e5]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Go"',
      kind: 'safe-reversible', selectorCache: 'e5' });
    expect(replayStep(edge, nodes)).toEqual({ status: 'ok', ref: 'e5', repaired: false });
  });

  it('deterministically re-resolves and reports repair when cached ref changed', () => {
    const nodes = parseSnapshot('- button "Go" [ref=e9]'); // ref changed, name same
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Go"',
      kind: 'safe-reversible', selectorCache: 'e5' });
    expect(replayStep(edge, nodes)).toEqual({ status: 'ok', ref: 'e9', repaired: true });
  });

  it('escalates (needs-navigation) when no deterministic match exists', () => {
    const nodes = parseSnapshot('- paragraph "nothing here"');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Go"',
      kind: 'safe-reversible', selectorCache: 'e5' });
    expect(replayStep(edge, nodes).status).toBe('escalate');
  });

  it('returns needs-classify for an unclassified edge (agent decides safety)', () => {
    const nodes = parseSnapshot('- button "Sponsor" [ref=e5]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Sponsor"',
      kind: 'unclassified', selectorCache: 'e5' });
    expect(replayStep(edge, nodes).status).toBe('needs-classify');
  });

  it('refuses to traverse a pre-tagged commit-point', () => {
    const nodes = parseSnapshot('- button "Place Order" [ref=e5]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Place Order"',
      kind: 'commit-point', selectorCache: 'e5' });
    expect(replayStep(edge, nodes).status).toBe('blocked-commit');
  });

  // Safety regression guard: even when the cached selector is present AND the
  // semantic step is resolvable, a commit-point must STILL block — never 'ok'.
  // Pins the branch priority so a future reorder fails loudly.
  it('blocks a commit-point even when its selector is live and resolvable', () => {
    const nodes = parseSnapshot('- button "Place Order" [ref=e5]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Place Order"',
      kind: 'commit-point', selectorCache: 'e5' });
    const r = replayStep(edge, nodes);
    expect(r.status).toBe('blocked-commit');
    expect(r).not.toHaveProperty('ref'); // never yields a traversable ref
  });
});
