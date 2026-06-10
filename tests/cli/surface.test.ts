import { describe, it, expect } from 'vitest';
import { topLevelHelp, devHelp } from '../../src/cli-help.js';

describe('CLI surface', () => {
  it('top-level help shows the consumer verbs', () => {
    const h = topLevelHelp();
    for (const v of ['locate', 'read', 'recall', 'search', 'list-goals']) {
      expect(h).toContain(v);
    }
  });

  it('top-level help lists the dev verbs too, under a labeled dev section', () => {
    const h = topLevelHelp();
    // dev verbs ARE shown in the single top-level menu (complete tool list)...
    expect(h).toMatch(/^\s+node-add\b/m);
    expect(h).toMatch(/^\s+edge-add\b/m);
    expect(h).toMatch(/^\s+dashboard\b/m);
    // ...but kept in their own category, invoked as `webnav dev <command>`.
    expect(h).toMatch(/dev — /);
    expect(h).toContain('webnav dev <command>');
  });

  it('dev help lists the admin verbs', () => {
    const h = devHelp();
    for (const v of ['graph', 'node-add', 'edge-add', 'list', 'describe', 'capture']) {
      expect(h).toContain(v);
    }
  });

  it('recall summary no longer hardcodes GitHub', () => {
    const h = topLevelHelp();
    expect(h).toMatch(/recall/);
    expect(h).not.toMatch(/Navigate GitHub for a use-case/);
  });
});
