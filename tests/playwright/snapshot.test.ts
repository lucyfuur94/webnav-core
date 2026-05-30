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
});
