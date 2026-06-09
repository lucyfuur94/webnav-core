import { describe, it, expect } from 'vitest';
import { COMMANDS, VERSION } from '../src/cli-spec.js';

describe('COMMANDS registry', () => {
  it('has all the registered verbs', () => {
    const names = COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(['capture', 'click', 'describe', 'edge-add', 'eval', 'go-back', 'graph', 'graph-analyse', 'graph-edit', 'graph-show', 'hop', 'list', 'list-goals', 'locate', 'mermaid', 'navigate', 'network', 'node-add', 'outline', 'read', 'recall', 'record-start', 'record-stop', 'reload', 'route', 'search', 'snapshot', 'standalone', 'type', 'walk', 'walk-resume']);
  });

  it('graph has a summary and an example', () => {
    const g = COMMANDS.find((c) => c.name === 'graph')!;
    expect(g.summary.length).toBeGreaterThan(0);
    expect(g.example).toContain('webnav graph');
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

  it('route has a summary, an example, and a --capability flag', () => {
    const r = COMMANDS.find((c) => c.name === 'route')!;
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.example).toContain('webnav route');
    const cap = r.flags.find((f) => f.name === '--capability')!;
    expect(cap).toBeDefined();
    expect(cap.takesValue).toBe(true);
    const request = r.args.find((a) => a.name === 'request')!;
    expect(request.required).toBe(true);
  });

  it('hop has a summary, an example, and --to-cluster/--to-node flags', () => {
    const h = COMMANDS.find((c) => c.name === 'hop')!;
    expect(h.summary.length).toBeGreaterThan(0);
    expect(h.example).toContain('webnav hop');
    expect(h.flags.find((f) => f.name === '--to-cluster')?.takesValue).toBe(true);
    expect(h.flags.find((f) => f.name === '--to-node')?.takesValue).toBe(true);
    const url = h.args.find((a) => a.name === 'url')!;
    expect(url.required).toBe(true);
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
