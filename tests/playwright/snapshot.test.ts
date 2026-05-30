import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSnapshot, findByRoleAndName } from '../../src/playwright/snapshot.js';

const yml = readFileSync('tests/fixtures/snapshot-example.yml', 'utf8');

describe('parseSnapshot', () => {
  it('flattens nodes with role, name, ref', () => {
    const nodes = parseSnapshot(yml);
    const link = nodes.find((n) => n.ref === 'e6');
    expect(link?.role).toBe('link');
    expect(link?.name).toBe('Learn more');
    expect(link?.url).toBe('https://iana.org/domains/example');
  });

  it('captures interactive elements', () => {
    const nodes = parseSnapshot(yml);
    expect(nodes.find((n) => n.role === 'searchbox')?.ref).toBe('e8');
    expect(nodes.find((n) => n.role === 'button' && n.name === 'Search')?.ref).toBe('e9');
  });

  it('findByRoleAndName locates an element', () => {
    const nodes = parseSnapshot(yml);
    expect(findByRoleAndName(nodes, 'searchbox')?.ref).toBe('e8');
  });

  it('node with no ref has ref null', () => {
    const nodes = parseSnapshot('- heading "Title" [level=1]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].ref).toBeNull();
    expect(nodes[0].name).toBe('Title');
  });

  it('node with no name has name null', () => {
    const nodes = parseSnapshot('- generic [ref=e2]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBeNull();
    expect(nodes[0].ref).toBe('e2');
  });

  it('attaches each /url: to its own link node', () => {
    const yaml = [
      '- link "First" [ref=e1]:',
      '    - /url: https://example.com/one',
      '- link "Second" [ref=e2]:',
      '    - /url: https://example.com/two',
    ].join('\n');
    const nodes = parseSnapshot(yaml);
    expect(nodes.find((n) => n.ref === 'e1')?.url).toBe('https://example.com/one');
    expect(nodes.find((n) => n.ref === 'e2')?.url).toBe('https://example.com/two');
  });

  it('parses a capitalized role with a name (regression: #1)', () => {
    const nodes = parseSnapshot('- StaticText "hi"');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('StaticText');
    expect(nodes[0].name).toBe('hi');
  });

  it('parses a capitalized role with only a ref (regression: #1)', () => {
    const nodes = parseSnapshot('- RootWebArea [ref=e1]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('RootWebArea');
    expect(nodes[0].ref).toBe('e1');
  });

  it('does not turn a standalone prose line into a node (regression: #2)', () => {
    const nodes = parseSnapshot('- this domain is for use');
    expect(nodes).toHaveLength(0);
  });

  it('findByRoleAndName returns undefined for a name that does not exist', () => {
    const nodes = parseSnapshot(yml);
    expect(findByRoleAndName(nodes, 'searchbox', 'Nonexistent')).toBeUndefined();
  });
});
