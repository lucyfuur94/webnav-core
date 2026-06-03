import { describe, it, expect } from 'vitest';
import { topLevelHelp, devHelp } from '../../src/cli-help.js';

describe('CLI surface', () => {
  it('top-level help shows the consumer verbs', () => {
    const h = topLevelHelp();
    for (const v of ['locate', 'read', 'recall', 'search', 'list-goals']) {
      expect(h).toContain(v);
    }
  });

  it('top-level help does NOT list admin verbs (they live under dev)', () => {
    const h = topLevelHelp();
    expect(h).not.toMatch(/^\s+add-node\b/m);
    expect(h).not.toMatch(/^\s+add-edge\b/m);
    expect(h).toContain('webnav dev');
  });

  it('dev help lists the admin verbs', () => {
    const h = devHelp();
    for (const v of ['graph', 'add-node', 'add-edge', 'list', 'describe', 'capture']) {
      expect(h).toContain(v);
    }
  });

  it('recall summary no longer hardcodes GitHub', () => {
    const h = topLevelHelp();
    expect(h).toMatch(/recall/);
    expect(h).not.toMatch(/Navigate GitHub for a use-case/);
  });
});
