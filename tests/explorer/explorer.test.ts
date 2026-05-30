import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveEdges } from '../../src/explorer/explorer.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const nodes = parseSnapshot(readFileSync('tests/fixtures/github-search.yml', 'utf8'));

describe('deriveEdges', () => {
  it('creates navigate edges for declared links with urls', () => {
    const edges = deriveEdges(nodes, 'search');
    const linkEdges = edges.filter((e) => e.kind === 'navigate');
    expect(linkEdges.length).toBe(2); // tenacity + urllib3
    expect(linkEdges[0].selectorCache).toBe('e10');
  });

  it('marks the searchbox as a safe input edge that accepts the query', () => {
    const edges = deriveEdges(nodes, 'search');
    const input = edges.find((e) => e.selectorCache === 'e2');
    expect(input?.kind).toBe('safe-reversible');
    expect(input?.acceptsInput).toBe('query');
  });

  it('records buttons as UNCLASSIFIED (webnav does not decide safe vs commit)', () => {
    const edges = deriveEdges(nodes, 'search');
    const sponsor = edges.find((e) => e.selectorCache === 'e20');
    expect(sponsor?.kind).toBe('unclassified');
  });
});
