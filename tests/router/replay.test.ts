import { describe, it, expect } from 'vitest';
import { replayStep } from '../../src/router/replay.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { makeEdge } from '../../src/mapstore/types.js';

describe('replayStep (deterministic, zero LLM)', () => {
  it('resolves by the step name regardless of which ephemeral ref it carries', () => {
    // The cache holds NAMES, not refs (a ref is reassigned every snapshot). The
    // step's own name "Go" resolves on whatever ref the live page assigns.
    const nodes = parseSnapshot('- button "Go" [ref=e9]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Go"',
      kind: 'safe-reversible' });
    expect(replayStep(edge, nodes)).toEqual({ status: 'ok', ref: 'e9', repaired: false });
  });

  it('SELF-HEAL: a drifted step resolves via the cached name written back on a prior walk', () => {
    // The step's own name "Open Cart" no longer matches the page (renamed to
    // "Shopping cart"). selectorCache carries the healed NAME from a prior walk,
    // so the step resolves deterministically again instead of escalating.
    const nodes = parseSnapshot('- button "Shopping cart" [ref=e3]');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Open Cart"',
      kind: 'safe-reversible', selectorCache: 'Shopping cart' });
    expect(replayStep(edge, nodes)).toEqual({ status: 'ok', ref: 'e3', repaired: true });
  });

  it('escalates (needs-navigation) when neither the step name nor the cache matches', () => {
    const nodes = parseSnapshot('- paragraph "nothing here"');
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Go"',
      kind: 'safe-reversible', selectorCache: 'Shopping cart' });
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
