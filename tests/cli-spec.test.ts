import { describe, it, expect } from 'vitest';
import { COMMANDS, VERSION } from '../src/cli-spec.js';

describe('COMMANDS registry', () => {
  it('has all six verbs', () => {
    const names = COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(['capture', 'describe', 'list', 'locate', 'recall', 'search']);
  });

  it('every command has a non-empty summary and example', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.example.length).toBeGreaterThan(0);
      expect(c.example).toContain('webnav');
    }
  });

  it('recall declares a --top flag with default 10', () => {
    const recall = COMMANDS.find((c) => c.name === 'recall')!;
    const top = recall.flags.find((f) => f.name === '--top')!;
    expect(top).toBeDefined();
    expect(top.takesValue).toBe(true);
    expect(top.default).toBe('10');
  });

  it('search declares a --top flag with default 3', () => {
    const search = COMMANDS.find((c) => c.name === 'search')!;
    const top = search.flags.find((f) => f.name === '--top')!;
    expect(top).toBeDefined();
    expect(top.takesValue).toBe(true);
    expect(top.default).toBe('3');
  });

  it('describe and locate require a place arg', () => {
    for (const name of ['describe', 'locate']) {
      const c = COMMANDS.find((cmd) => cmd.name === name)!;
      const place = c.args.find((a) => a.name === 'place')!;
      expect(place.required).toBe(true);
    }
  });

  it('exports a version string', () => {
    expect(VERSION).toMatch(/\d+\.\d+\.\d+/);
  });
});
