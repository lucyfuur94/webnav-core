import { describe, it, expect } from 'vitest';
import { proposeFromUnknown, parseFromUnknownArg, ghPrCommand, type UnknownLike } from '../../src/explorer/pattern-propose.js';
import { lintPackEntry } from '../../src/explorer/patterns.js';

const overlayUnknown: UnknownLike = {
  kind: 'undetected-overlay',
  evidence: 'button "Custom" [ref=e1]\nbutton "Yesterday" [ref=e2]\ngridcell "1" [ref=e3]\ngridcell "2" [ref=e4]',
  context: 'report-flat: clicking "Pick date" added 4 named nodes but neither the built-in overlay detection nor any pattern pack recognized it as an overlay — stayed \'mutate\'',
  extensionPoint: 'overlay-open',
};

const valueUnknown: UnknownLike = { ...overlayUnknown, extensionPoint: 'value-domain' };

const coreDesignUnknown: UnknownLike = {
  kind: 'ambiguous-cluster',
  evidence: '',
  context: 'dashboard: same-url state with no distinguishing heading',
  extensionPoint: 'core-design',
};

describe('proposeFromUnknown — pack-scaffoldable extensionPoints', () => {
  it('scaffolds an overlay-open pack with context diff.added and a TODO (empty) trigger', () => {
    const r = proposeFromUnknown(overlayUnknown, 'my-picker');
    expect(r.pack).toBeTruthy();
    expect(r.pack!.name).toBe('my-picker');
    expect(r.pack!.type).toBe('overlay-open');
    expect(r.pack!.trigger.context).toBe('diff.added');
    expect(r.pack!.trigger.contains).toEqual([]);
    expect(r.pack!.fixture.expect).toBe('matched');
    expect(r.pack!.fixture.snapshot).toContain('button "Custom"');
    expect(r.pack!.evidence.length).toBeGreaterThan(0);
    expect(r.coreDesignBoundary).toBeUndefined();
  });

  it('scaffolds a value-domain pack with context overlay', () => {
    const r = proposeFromUnknown(valueUnknown, 'my-values');
    expect(r.pack!.type).toBe('value-domain');
    expect(r.pack!.trigger.context).toBe('overlay');
  });

  it('the scaffolded pack FAILS lint on the TODO trigger (empty contains) — expected, not a bug', () => {
    const r = proposeFromUnknown(overlayUnknown, 'my-picker');
    expect(r.lintReasons.length).toBeGreaterThan(0);
    expect(r.lintReasons.join('\n')).toContain('non-empty array of predicates');
    // proves the returned lintReasons actually come from the real lintPackEntry, not a stand-in.
    expect(lintPackEntry(r.pack)).toEqual(r.lintReasons);
  });

  it('once the agent fills a real trigger.contains, the SAME scaffolded fixture lints clean', () => {
    const r = proposeFromUnknown(overlayUnknown, 'my-picker');
    const filled = { ...r.pack!, trigger: { ...r.pack!.trigger, contains: [{ role: 'gridcell', min: 2 }] } };
    expect(lintPackEntry(filled)).toEqual([]);
  });

  it('the fixture snapshot wraps every evidence line as a depth-0 node (parseSnapshot-valid)', () => {
    const r = proposeFromUnknown(overlayUnknown, 'my-picker');
    const lines = r.pack!.fixture.snapshot.split('\n');
    expect(lines.every((l) => l.startsWith('- '))).toBe(true);
    expect(lines.length).toBe(4);   // one per non-blank evidence line
  });
});

describe('proposeFromUnknown — core-design boundary (honest decline, no invented pack type)', () => {
  it('returns pack:null + a coreDesignBoundary reason, never scaffolds', () => {
    const r = proposeFromUnknown(coreDesignUnknown, 'whatever');
    expect(r.pack).toBeNull();
    expect(r.lintReasons).toEqual([]);
    expect(r.coreDesignBoundary).toMatch(/core-design/);
    expect(r.coreDesignBoundary).toMatch(/file a core-design issue/i);
  });
});

describe('parseFromUnknownArg', () => {
  it('splits "<path>#<index>"', () => {
    expect(parseFromUnknownArg('draft.json#3')).toEqual({ path: 'draft.json', index: 3 });
  });
  it('handles a path containing no special chars and index 0', () => {
    expect(parseFromUnknownArg('/a/b/c/draft.json#0')).toEqual({ path: '/a/b/c/draft.json', index: 0 });
  });
  it('throws on missing #', () => {
    expect(() => parseFromUnknownArg('draft.json')).toThrow(/must be/);
  });
  it('throws on a non-integer index', () => {
    expect(() => parseFromUnknownArg('draft.json#abc')).toThrow(/must be/);
  });
  it('throws on a negative index', () => {
    expect(() => parseFromUnknownArg('draft.json#-1')).toThrow(/must be/);
  });
});

describe('ghPrCommand', () => {
  it('generates a gh pr create command citing the evidence, never auto-runs', () => {
    const r = proposeFromUnknown(overlayUnknown, 'my-picker');
    const cmd = ghPrCommand(r.pack!, overlayUnknown);
    expect(cmd).toContain('gh pr create');
    expect(cmd).toContain('my-picker');
    expect(cmd).toContain('button \\"Custom\\"');   // evidence cited in the body (JSON-escaped)
  });
});
