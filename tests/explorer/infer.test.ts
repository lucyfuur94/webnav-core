import { describe, it, expect } from 'vitest';
import { inferUrlModel, proposeTemplates } from '../../src/explorer/infer.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { faceOf, jaccard, insideOverlay, nodeIndexByName } from '../../src/explorer/infer.js';
import { extractShell, templateCore } from '../../src/explorer/infer.js';

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
