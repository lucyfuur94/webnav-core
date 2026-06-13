import { describe, it, expect } from 'vitest';
import { COMMANDS, VERSION } from '../src/cli-spec.js';

describe('COMMANDS registry', () => {
  it('has all the registered verbs', () => {
    const names = COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(['capture', 'click', 'creds', 'dashboard', 'describe', 'edge-add', 'effects', 'eval', 'export-map', 'go-back', 'graph-analyse', 'graph-edit', 'graph-show', 'list', 'login', 'mcp', 'mermaid', 'navigate', 'network', 'node-add', 'outline', 'read', 'record-start', 'record-stop', 'reload', 'search', 'sessions', 'snapshot', 'type', 'walk', 'walk-resume']);
  });

  it('outline has a summary and an example', () => {
    const g = COMMANDS.find((c) => c.name === 'outline')!;
    expect(g.summary.length).toBeGreaterThan(0);
    expect(g.example).toContain('outline');
  });

  it('node-add has a required id arg and --url/--capabilities/--topics flags', () => {
    const a = COMMANDS.find((c) => c.name === 'node-add')!;
    expect(a.summary.length).toBeGreaterThan(0);
    expect(a.example).toContain('webnav dev node-add');
    expect(a.args.find((arg) => arg.name === 'id')?.required).toBe(true);
    expect(a.flags.find((f) => f.name === '--url')?.takesValue).toBe(true);
    expect(a.flags.find((f) => f.name === '--capabilities')?.takesValue).toBe(true);
    expect(a.flags.find((f) => f.name === '--topics')?.takesValue).toBe(true);
  });

  it('edge-add has required from/to args and a --kind flag defaulting to capability', () => {
    const a = COMMANDS.find((c) => c.name === 'edge-add')!;
    expect(a.summary.length).toBeGreaterThan(0);
    expect(a.example).toContain('webnav dev edge-add');
    expect(a.args.find((arg) => arg.name === 'from')?.required).toBe(true);
    expect(a.args.find((arg) => arg.name === 'to')?.required).toBe(true);
    const kind = a.flags.find((f) => f.name === '--kind')!;
    expect(kind.takesValue).toBe(true);
    expect(kind.default).toBe('capability');
  });

  it('every command has a non-empty summary and example', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.example.length).toBeGreaterThan(0);
      expect(c.example).toContain('webnav');
    }
  });

  it('search declares a --top flag with default 3', () => {
    const search = COMMANDS.find((c) => c.name === 'search')!;
    const top = search.flags.find((f) => f.name === '--top')!;
    expect(top).toBeDefined();
    expect(top.takesValue).toBe(true);
    expect(top.default).toBe('3');
  });

  it('describe requires a place arg', () => {
    const c = COMMANDS.find((cmd) => cmd.name === 'describe')!;
    const place = c.args.find((a) => a.name === 'place')!;
    expect(place.required).toBe(true);
  });

  it('exports a version string', () => {
    expect(VERSION).toMatch(/\d+\.\d+\.\d+/);
  });
});
