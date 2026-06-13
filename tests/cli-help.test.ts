import { describe, it, expect } from 'vitest';
import { topLevelHelp, commandHelp } from '../src/cli-help.js';

describe('topLevelHelp', () => {
  it('lists consumer commands with their summaries', () => {
    const h = topLevelHelp();
    for (const c of ['read', 'search', 'walk'])
      expect(h).toContain(c);
    expect(h).toMatch(/--help/);
    expect(h).toMatch(/--version/);
    expect(h).toMatch(/--json/);
    expect(h).toMatch(/webnav <command> --help/);
    expect(h).toContain('webnav dev');
  });
});

describe('commandHelp', () => {
  it('shows usage, args, flags with defaults, and an example for search', () => {
    const h = commandHelp('search');
    expect(h).toMatch(/Usage: webnav search/);
    expect(h).toContain('query');
    expect(h).toMatch(/--top/);
    expect(h).toMatch(/3/); // default shown
    expect(h).toMatch(/Example/i);
  });
  it('shows the search default top of 3', () => {
    const h = commandHelp('search');
    expect(h).toMatch(/--top/);
    expect(h).toMatch(/default: 3/);
  });
  it('shows required args for capture', () => {
    const h = commandHelp('capture');
    expect(h).toContain('url');
    expect(h).toContain('out');
    expect(h).toMatch(/required/);
  });
  it('handles an unknown command name gracefully', () => {
    expect(() => commandHelp('bogus')).not.toThrow();
    expect(commandHelp('bogus')).toMatch(/unknown|no such/i);
  });
});
