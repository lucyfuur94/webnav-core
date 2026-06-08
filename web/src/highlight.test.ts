import { describe, it, expect } from 'vitest';
import { neighborSet, nodeOpacity, edgeActive } from './highlight.js';

const edges = [
  { source: 'login', target: 'inventory' },
  { source: 'inventory', target: 'cart' },
  { source: 'inventory', target: 'product-detail' },
  { source: 'cart', target: 'inventory' },
];

describe('hover highlight', () => {
  it('no hover → null neighbor set (everything full)', () => {
    expect(neighborSet(null, edges)).toBeNull();
    expect(nodeOpacity('cart', null, 0.18)).toBe(1);
    expect(edgeActive(edges[0], null)).toBe(true);
  });

  it('hovering inventory includes it + all directly-connected nodes', () => {
    const ns = neighborSet('inventory', edges)!;
    expect([...ns].sort()).toEqual(['cart', 'inventory', 'login', 'product-detail']);
  });

  it('dims a non-neighbor node, keeps neighbors full', () => {
    const ns = neighborSet('inventory', edges)!;
    expect(nodeOpacity('inventory', ns, 0.18)).toBe(1);   // hovered
    expect(nodeOpacity('cart', ns, 0.18)).toBe(1);        // neighbor
    expect(nodeOpacity('checkout-info', ns, 0.18)).toBe(0.18); // not connected
  });

  it('edge is active only if it touches the hovered node', () => {
    expect(edgeActive({ source: 'login', target: 'inventory' }, 'inventory')).toBe(true);
    expect(edgeActive({ source: 'cart', target: 'checkout-info' }, 'inventory')).toBe(false);
  });
});
