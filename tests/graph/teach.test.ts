import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { addNode, addEdge } from '../../src/graph/teach.js';
describe('addNode/addEdge', () => {
  it('adds a node that can be read back and exported', () => {
    const s = new MapStore(':memory:');
    addNode(s, { id: 'npmjs.com', homeUrl: 'https://www.npmjs.com', capabilities: ['package-search'], topics: ['javascript'] });
    expect(s.getNode('npmjs.com')?.capabilities).toEqual(['package-search']);
  });
  it('adds an edge between two known nodes', () => {
    const s = new MapStore(':memory:');
    addNode(s, { id: 'a', homeUrl: 'https://a', capabilities: [], topics: [] });
    addNode(s, { id: 'b', homeUrl: 'https://b', capabilities: [], topics: [] });
    expect(addEdge(s, { from: 'a', to: 'b', kind: 'capability' })).toEqual({ status: 'added', from: 'a', to: 'b', kind: 'capability' });
    expect(s.nodeEdgesFrom('a')).toHaveLength(1);
  });
  it('refuses an edge to an unknown node', () => {
    const s = new MapStore(':memory:');
    addNode(s, { id: 'a', homeUrl: 'https://a', capabilities: [], topics: [] });
    expect(addEdge(s, { from: 'a', to: 'ghost', kind: 'capability' }).status).toBe('unknown-node');
  });
  it('throws on empty id or url', () => {
    const s = new MapStore(':memory:');
    expect(() => addNode(s, { id: '', homeUrl: 'x', capabilities: [], topics: [] })).toThrow();
  });
});
