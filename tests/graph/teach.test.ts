import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { addNode } from '../../src/graph/teach.js';
describe('addNode', () => {
  it('adds a node that can be read back', () => {
    const s = new MapStore(':memory:');
    addNode(s, { id: 'npmjs.com', homeUrl: 'https://www.npmjs.com' });
    expect(s.getNode('npmjs.com')?.homeUrl).toBe('https://www.npmjs.com');
  });
  it('throws on empty id or url', () => {
    const s = new MapStore(':memory:');
    expect(() => addNode(s, { id: '', homeUrl: 'x' })).toThrow();
    expect(() => addNode(s, { id: 'a', homeUrl: '' })).toThrow();
  });
});
