import { describe, it, expect } from 'vitest';
import { inferUrlModel, proposeTemplates } from '../../src/explorer/infer.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { faceOf, jaccard, insideOverlay, nodeIndexByName } from '../../src/explorer/infer.js';
import { extractShell, templateCore } from '../../src/explorer/infer.js';
import { foldRepeats, subtreeFolds } from '../../src/explorer/infer.js';

describe('inferUrlModel', () => {
  it('infers a multi-segment base shared by ≥80% of urls and merges base-less redirect ghosts', () => {
    const urls = [
      'https://x.test/v3/1041/report/list', 'https://x.test/v3/1041/report/16116/aa11',
      'https://x.test/v3/1041/dashboard/list', 'https://x.test/v3/1041/dashboard/1210',
      'https://x.test/v3/1041/announcements', 'https://x.test/v3/1041/help-center',
      'https://x.test/v3/report/list',           // pre-redirect ghost: missing tenant
    ];
    const m = inferUrlModel(urls);
    expect(m.base).toEqual(['v3', '1041']);
    expect(m.keyOf('https://x.test/v3/report/list')).toBe('/report/list');       // ghost merges
    expect(m.keyOf('https://x.test/v3/1041/report/list?tab=1#x')).toBe('/report/list'); // query/hash dropped
  });
  it('no base when paths share no constant prefix (github-style)', () => {
    const m = inferUrlModel(['https://g.test/facebook/react', 'https://g.test/trending', 'https://g.test/vuejs/vue']);
    expect(m.base).toEqual([]);
    expect(m.keyOf('https://g.test/facebook/react')).toBe('/facebook/react');
  });
  // Task 15 finding: snapshot link hrefs are RELATIVE (`/v3/1041/report/list`), not absolute.
  // keyOf must strip the base from a relative href to the SAME key as the absolute toUrl — else
  // every sidebar link keyed to `/` and no from-anywhere shell edge ever resolved (progneo shell
  // had 4 affordances instead of the sidebar's full set until this was fixed).
  it('keys a RELATIVE href to the same key as the absolute url (shell edges resolve)', () => {
    const m = inferUrlModel(['https://x.test/v3/1041/report/list', 'https://x.test/v3/1041/dashboard/list',
      'https://x.test/v3/1041/announcements', 'https://x.test/v3/1041/help-center']);
    expect(m.base).toEqual(['v3', '1041']);
    expect(m.keyOf('/v3/1041/report/list')).toBe('/report/list');   // relative → same key as absolute
    expect(m.keyOf('https://x.test/v3/1041/report/list')).toBe('/report/list');
  });
});

describe('proposeTemplates', () => {
  it('groups keys equal in all but one position (slug ids too — no digit/hex regex)', () => {
    const groups = proposeTemplates(['/products/blue-widget', '/products/red-widget', '/cart']);
    expect(groups).toEqual([{ template: '/products/{param}', keys: ['/products/blue-widget', '/products/red-widget'], paramPos: 1 }]);
  });
  it('a group is only PROPOSED — /dashboard/list vs /dashboard/1210 still groups here (disposal is structural, draft-side)', () => {
    const groups = proposeTemplates(['/dashboard/list', '/dashboard/1210']);
    expect(groups[0].template).toBe('/dashboard/{param}');
  });
});

const PAGE_WITH_DIALOG = [
  '- button "Add dimensions" [ref=e1] [cursor=pointer]',
  '- button "Share" [ref=e2]',
  '- dialog [ref=e3]:',
  '  - textbox "Search" [ref=e4]',
  '  - checkbox "Publisher" [ref=e5]',
  '  - checkbox "Country" [ref=e6]',
  '  - button "Apply" [ref=e7]',
  '- button "Run" [ref=e8]',
].join('\n');

describe('faces + overlay membership', () => {
  const nodes = parseSnapshot(PAGE_WITH_DIALOG);
  it('faceOf = role:name set of named nodes', () => {
    expect(faceOf(nodes).has('button:Share')).toBe(true);
    expect(faceOf(nodes).has('dialog:')).toBe(false);          // unnamed containers excluded
  });
  it('jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(1);             // two empty faces are identical
  });
  it('insideOverlay: picker options/controls are inside; openers and page buttons are not', () => {
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Publisher'))).toBe(true);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Apply'))).toBe(true);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Add dimensions'))).toBe(false);
    expect(insideOverlay(nodes, nodeIndexByName(nodes, 'Run'))).toBe(false);   // AFTER the dialog, same depth
  });
});

describe('extractShell', () => {
  it('nodes on ≥80% of distinct pages are shell', () => {
    const sidebar = ['link:Reports', 'link:Dashboards', 'button:Dark Mode'];
    const faces = [
      new Set([...sidebar, 'heading:Reports', 'button:New Report']),
      new Set([...sidebar, 'heading:Dashboards']),
      new Set([...sidebar, 'heading:Downloads']),
      new Set([...sidebar, 'heading:Help Center']),
      new Set([...sidebar, 'heading:Announcements']),
    ];
    expect(extractShell(faces)).toEqual(new Set(sidebar));
  });
  it('empty when fewer than 4 pages (no shell claim on tiny evidence)', () => {
    expect(extractShell([new Set(['a']), new Set(['a'])])).toEqual(new Set());
  });
});

describe('templateCore', () => {
  it('n≥2: keeps tokens in ≥60% of landings (structure), drops the varying remainder (data)', () => {
    const r = templateCore([
      new Set(['button:Refresh list', 'link:file-aug.csv', 'tab:Owned']),
      new Set(['button:Refresh list', 'link:file-sep.csv', 'tab:Owned']),
    ]);
    expect(r.tokens).toEqual(new Set(['button:Refresh list', 'tab:Owned']));   // rows fell out
    expect(r.provisional).toBeNull();
  });
  it('n=1: keeps everything but marks provisional with an actionable note', () => {
    const r = templateCore([new Set(['heading:Dashboards', 'link:ASJDH'])]);
    expect(r.tokens.size).toBe(2);
    expect(r.provisional).toMatch(/seen once/i);
  });
});

describe('foldRepeats', () => {
  it('≥3 same-role same-depth siblings sharing a trailing word with varying prefixes fold to one', () => {
    const nodes = parseSnapshot([
      '- button "OS Remove" [ref=e1]', '- button "Revenue Remove" [ref=e2]',
      '- button "Win Rate Remove" [ref=e3]', '- button "eCPM Remove" [ref=e4]',
      '- button "Share" [ref=e5]',
    ].join('\n'));
    const { folds, foldedNames } = foldRepeats(nodes);
    expect(folds).toEqual([{ role: 'button', suffix: 'Remove', count: 4 }]);
    expect(foldedNames.has('OS Remove')).toBe(true);
    expect(foldedNames.has('Share')).toBe(false);
  });
  it('two repeats do not fold (below evidence threshold)', () => {
    const nodes = parseSnapshot(['- button "A Remove" [ref=e1]', '- button "B Remove" [ref=e2]'].join('\n'));
    expect(foldRepeats(nodes).folds).toEqual([]);
  });
});

describe('subtreeFolds', () => {
  // Fixture 1 — dashboard-shaped: 3 widget subtrees (titles differ, same control set) under one
  // container + a page-level Setup button → ONE named-level fold, count 3, Setup untouched.
  it('folds repeated widget subtrees on their identical control set (named); page control untouched', () => {
    const nodes = parseSnapshot([
      '- main [ref=e0]:',
      '  - button "Setup" [ref=e1]',
      '  - generic [ref=e2]:',                       // widget container
      '    - generic [ref=e3]:',
      '      - heading "Revenue" [ref=e4]',
      '      - button "Download chart as PNG" [ref=e5]',
      '      - button "Full screen" [ref=e6]',
      '    - generic [ref=e7]:',
      '      - heading "Sessions" [ref=e8]',
      '      - button "Download chart as PNG" [ref=e9]',
      '      - button "Full screen" [ref=e10]',
      '    - generic [ref=e11]:',
      '      - heading "Bounce rate" [ref=e12]',
      '      - button "Download chart as PNG" [ref=e13]',
      '      - button "Full screen" [ref=e14]',
    ].join('\n'));
    const { folds, foldedIndices } = subtreeFolds(nodes);
    expect(folds).toHaveLength(1);
    expect(folds[0].level).toBe('named');
    expect(folds[0].count).toBe(3);
    expect(folds[0].unitSize).toBeGreaterThanOrEqual(3);   // heading + 2 buttons
    expect(folds[0].label).toBe('Download chart as PNG');  // first stable control name in the unit
    // Setup (the page-level button) is NOT folded.
    expect(foldedIndices.has(nodeIndexByName(nodes, 'Setup'))).toBe(false);
    // Every node inside all 3 widgets IS folded (roots + headings + buttons).
    expect(foldedIndices.has(nodeIndexByName(nodes, 'Revenue'))).toBe(true);
    expect(foldedIndices.has(nodeIndexByName(nodes, 'Full screen'))).toBe(true);
  });

  // Fixture 2 — leaf chips: 7 buttons "<X> Remove" (varying prefixes). Same role, DISTINCT L1 sigs
  // (name kept for controls), same L2 sig → abstracted-level fold, label 'Remove', unit is a leaf.
  it('folds ≥3 varying-prefix leaf controls (abstracted), label = common trailing word, unitSize 1', () => {
    const nodes = parseSnapshot([
      '- toolbar [ref=e0]:',
      '  - button "OS Remove" [ref=e1]',
      '  - button "Revenue Remove" [ref=e2]',
      '  - button "Win Rate Remove" [ref=e3]',
      '  - button "eCPM Remove" [ref=e4]',
      '  - button "Country Remove" [ref=e5]',
      '  - button "Device Remove" [ref=e6]',
      '  - button "Channel Remove" [ref=e7]',
    ].join('\n'));
    const { folds } = subtreeFolds(nodes);
    expect(folds).toHaveLength(1);
    expect(folds[0].level).toBe('abstracted');
    expect(folds[0].count).toBe(7);
    expect(folds[0].label).toBe('Remove');
    expect(folds[0].unitSize).toBe(1);
  });
  it('two varying-prefix controls do NOT fold (abstracted threshold ≥3)', () => {
    const nodes = parseSnapshot([
      '- toolbar [ref=e0]:',
      '  - button "OS Remove" [ref=e1]',
      '  - button "Revenue Remove" [ref=e2]',
    ].join('\n'));
    expect(subtreeFolds(nodes).folds).toEqual([]);
  });

  // Fixture 3 — identical-name repeats: 25 identical buttons share an L1 sig → named fold count 25.
  it('folds 25 identical-name sibling buttons (named)', () => {
    const lines = ['- table [ref=e0]:'];
    for (let i = 1; i <= 25; i++) lines.push(`  - button "Expand drilldown" [ref=e${i}]`);
    const { folds } = subtreeFolds(parseSnapshot(lines.join('\n')));
    expect(folds).toHaveLength(1);
    expect(folds[0].level).toBe('named');
    expect(folds[0].count).toBe(25);
    expect(folds[0].label).toBe('Expand drilldown');
  });

  // Fixture 4 — nested: widgets each contain repeated rows. Inner rows fold under each widget AND
  // the outer widgets still fold (bottom-up: the shared inner structure makes the widget sigs match).
  it('folds inner repeated rows AND outer repeated widgets (bottom-up)', () => {
    const lines = ['- main [ref=e0]:'];
    let ref = 1;
    for (let w = 0; w < 2; w++) {          // 2 widgets
      lines.push(`  - generic [ref=e${ref++}]:`);                       // widget root
      lines.push(`    - heading "Widget ${w}" [ref=e${ref++}]`);
      for (let r = 0; r < 3; r++) {        // 3 rows each
        lines.push(`    - generic [ref=e${ref++}]:`);                   // row root
        lines.push(`      - button "Edit" [ref=e${ref++}]`);
        lines.push(`      - button "Delete" [ref=e${ref++}]`);
      }
    }
    const { folds } = subtreeFolds(parseSnapshot(lines.join('\n')));
    // Inner: rows fold under EACH widget (per-parent) → 2 row folds of count 3; outer: 2 widgets
    // fold under main → 1 widget fold of count 2. Three folds total.
    const named = folds.filter((f) => f.level === 'named');
    const rowFolds = named.filter((f) => f.count === 3);
    const widgetFolds = named.filter((f) => f.count === 2);
    expect(rowFolds).toHaveLength(2);
    expect(widgetFolds).toHaveLength(1);
    expect(widgetFolds[0].unitSize).toBeGreaterThan(rowFolds[0].unitSize);   // widget contains rows
  });

  // Fixture 5 — negative: 3 siblings with genuinely different SHAPES → no fold at either level.
  // (Each subtree has a distinct L1 AND a distinct L2, and no two share a parent-level shape.)
  it('does NOT fold siblings with genuinely different structures', () => {
    const nodes = parseSnapshot([
      '- main [ref=e0]:',
      '  - generic [ref=e1]:',
      '    - button "Save" [ref=e2]',
      '  - generic [ref=e3]:',
      '    - textbox "Search" [ref=e4]',
      '    - button "Go" [ref=e5]',
      '  - generic [ref=e6]:',
      '    - heading "Notes" [ref=e7]',
      '    - link "More" [ref=e8]',
      '    - button "Edit" [ref=e9]',
      '    - checkbox "Pin" [ref=e10]',
    ].join('\n'));
    expect(subtreeFolds(nodes).folds).toEqual([]);
  });

  // Fixture 6 — mixed-parent: same-signature subtrees under DIFFERENT parents do not fold together.
  it('does NOT fold same-sig subtrees that live under different parents', () => {
    const nodes = parseSnapshot([
      '- main [ref=e0]:',
      '  - generic [ref=e1]:',                       // parent A
      '    - button "Alpha Go" [ref=e2]',
      '  - generic [ref=e3]:',                       // parent B
      '    - button "Beta Go" [ref=e4]',
    ].join('\n'));
    // One "X Go" leaf under each of two parents: no parent has ≥2/≥3 to fold.
    expect(subtreeFolds(nodes).folds).toEqual([]);
  });

  // Edge — sibling groups directly under the root (no wrapping container).
  it('folds repeated groups that sit directly under the root', () => {
    const nodes = parseSnapshot([
      '- generic [ref=e1]:',
      '  - button "Copy" [ref=e2]',
      '  - button "Paste" [ref=e3]',
      '- generic [ref=e4]:',
      '  - button "Copy" [ref=e5]',
      '  - button "Paste" [ref=e6]',
    ].join('\n'));
    const { folds } = subtreeFolds(nodes);
    expect(folds).toHaveLength(1);
    expect(folds[0].level).toBe('named');
    expect(folds[0].count).toBe(2);
  });

  // Edge — pure unnamed generic wrappers carry nothing → never fold (skip-trivia rule).
  it('does NOT fold repeated empty/unnamed generic wrappers (no name, no control)', () => {
    const nodes = parseSnapshot([
      '- main [ref=e0]:',
      '  - generic [ref=e1]:',
      '    - generic [ref=e2]',
      '  - generic [ref=e3]:',
      '    - generic [ref=e4]',
      '  - generic [ref=e5]:',
      '    - generic [ref=e6]',
    ].join('\n'));
    expect(subtreeFolds(nodes).folds).toEqual([]);
  });

  // Edge — abstracted level needs ≥2 DISTINCT L1 sigs: 3 IDENTICAL leaves fold as NAMED, not abstracted.
  it('3 identical-name leaves fold as named (not abstracted — abstracted needs distinct L1s)', () => {
    const nodes = parseSnapshot([
      '- toolbar [ref=e0]:',
      '  - button "Remove" [ref=e1]',
      '  - button "Remove" [ref=e2]',
      '  - button "Remove" [ref=e3]',
    ].join('\n'));
    const { folds } = subtreeFolds(nodes);
    expect(folds).toHaveLength(1);
    expect(folds[0].level).toBe('named');
    expect(folds[0].count).toBe(3);
  });
});
