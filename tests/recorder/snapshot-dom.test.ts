// tests/recorder/snapshot-dom.test.ts
import { describe, it, expect } from 'vitest';
import { serializeSnapshot, type SerializableNode } from '../../src/recorder/snapshot-dom.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

describe('serializeSnapshot → parseSnapshot parity', () => {
  it('round-trips roles, names, refs, urls, and depth', () => {
    const root: SerializableNode = {
      role: 'RootWebArea', name: 'Login',
      children: [
        { role: 'textbox', name: 'Username' },
        { role: 'link', name: 'Learn more', url: 'https://x.test/more' },
        { role: 'button', name: null }, // icon-only: no name → must still parse via its ref
      ],
    };
    const nodes = parseSnapshot(serializeSnapshot(root));
    // every input node survives (icon-only included) → 4 nodes
    expect(nodes.length).toBe(4);
    const byRole = (r: string) => nodes.find((n) => n.role === r)!;
    expect(byRole('textbox').name).toBe('Username');
    expect(byRole('link').url).toBe('https://x.test/more');
    // synthetic refs are assigned to every node, sequential from e1
    expect(nodes.map((n) => n.ref)).toEqual(['e1', 'e2', 'e3', 'e4']);
    // depth increases for children of the root
    expect(byRole('RootWebArea').depth).toBeLessThan(byRole('textbox').depth);
  });

  it('the icon-only (nameless) button is recoverable by its ref', () => {
    const root: SerializableNode = { role: 'RootWebArea', name: 'X',
      children: [{ role: 'button', name: null }] };
    const nodes = parseSnapshot(serializeSnapshot(root));
    const btn = nodes.find((n) => n.role === 'button')!;
    expect(btn).toBeDefined();
    expect(btn.ref).toBe('e2');
  });
});
