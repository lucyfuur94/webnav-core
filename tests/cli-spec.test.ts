import { describe, it, expect } from 'vitest';
import { COMMANDS, VERSION } from '../src/cli-spec.js';

describe('COMMANDS registry', () => {
  it('has all the registered verbs', () => {
    const names = COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(['capture', 'capture-loop', 'click', 'close', 'creds', 'dashboard', 'edge-add', 'effects', 'eval', 'export-map', 'go-back', 'graph-analyse', 'graph-edit', 'graph-show', 'import-map', 'ingest', 'list', 'login', 'mcp', 'mermaid', 'navigate', 'network', 'node-add', 'node-clear', 'node-rm', 'outline', 'profile-status', 'read', 'record-live', 'record-rename', 'record-start', 'record-stop', 'reload', 'review', 'search', 'session', 'sessions', 'snapshot', 'type', 'verify', 'walk', 'walk-resume']);
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

  it('exports a version string', () => {
    expect(VERSION).toMatch(/\d+\.\d+\.\d+/);
  });

  it('graph-analyse help teaches provisional states, requests, and the _shell state', () => {
    const g = COMMANDS.find((c) => c.name === 'graph-analyse')!;
    expect(g.summary).toContain('provisional');
    expect(g.summary).toContain('requests');
    expect(g.summary.toLowerCase()).toContain('shell');
  });

  it('graph-analyse help teaches widget/row subtree folding and template-identity merging', () => {
    const g = COMMANDS.find((c) => c.name === 'graph-analyse')!;
    expect(g.summary).toContain("scope:'widget'|'row'");
    expect(g.summary.toLowerCase()).toContain('merge');
  });

  it('graph-analyse help teaches the extension loop: unknowns → pattern-propose → local pack → PR upstream', () => {
    const g = COMMANDS.find((c) => c.name === 'graph-analyse')!;
    expect(g.summary).toContain('unknowns');
    expect(g.summary).toContain('pattern-propose');
    expect(g.summary.toLowerCase()).toContain('pr upstream');
  });

  it('graph-edit help teaches provisional tri-state and scope passthrough', () => {
    const g = COMMANDS.find((c) => c.name === 'graph-edit')!;
    expect(g.summary).toContain('provisional');
    expect(g.summary).toContain('scope');
  });

  it('profile-status help teaches homeUrl-from-map, matchState-as-oracle, reap, and the exit-0 needs-login choice', () => {
    const p = COMMANDS.find((c) => c.name === 'profile-status')!;
    expect(p.summary).toContain('homeUrl');
    expect(p.summary).toContain('matchState');
    expect(p.summary).toContain('reaped');
    expect(p.summary).toContain('Exit 0');
    expect(p.flags.find((f) => f.name === '--profile')?.takesValue).toBe(true);
    expect(p.flags.find((f) => f.name === '--site')?.takesValue).toBe(true);
    expect(p.flags.find((f) => f.name === '--url')?.takesValue).toBe(true);
  });

  it('walk help documents the needs-auth response (fresh-session-retry-persisted SSO wall)', () => {
    const w = COMMANDS.find((c) => c.name === 'walk')!;
    expect(w.summary).toContain('needs-auth');
    expect(w.summary).toContain('fresh-session retry');
    expect(w.summary.toLowerCase()).toContain('not evasion');
  });

  it('navigate help documents the authWall/loginUrl output field', () => {
    const n = COMMANDS.find((c) => c.name === 'navigate')!;
    expect(n.summary).toContain('authWall');
    expect(n.summary).toContain('loginUrl');
    expect(n.summary).toContain('NEVER auto-retried');
  });
});
