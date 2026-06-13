import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { resolveByNear, deriveNear, nearStability } from '../../src/playwright/fingerprint.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const sd = parseSnapshot(readFileSync(join(FIX, 'saucedemo-inventory.yml'), 'utf8'));
const oh = parseSnapshot(readFileSync(join(FIX, 'orangehrm-pim-table.yml'), 'utf8'));
const refOf = (nodes: ReturnType<typeof parseSnapshot>, ref: string) => nodes.findIndex((n) => n.ref === ref);
// the two glyph button names in the OH fixture (edit/delete), discovered like the prototype
const ohFreq: Record<string, number> = {};
oh.filter((n) => n.role === 'button' && n.ref && n.depth >= 16).forEach((n) => { ohFreq[n.name ?? ''] = (ohFreq[n.name ?? ''] ?? 0) + 1; });
const [EDIT, DEL] = Object.entries(ohFreq).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);

describe('resolveByNear — MATCH (proven refs, real bytes)', () => {
  const cases: [string, ReturnType<typeof parseSnapshot>, string, string, string][] = [
    ['SD Backpack', sd, 'button', 'Add to cart', 'Sauce Labs Backpack'],
    ['SD Bike Light', sd, 'button', 'Add to cart', 'Sauce Labs Bike Light'],
    ['SD Fleece', sd, 'button', 'Add to cart', 'Sauce Labs Fleece Jacket'],
    ['OH edit row 444444', oh, 'button', EDIT, '444444'],
    ['OH delete row 444444', oh, 'button', DEL, '444444'],
  ];
  const want: Record<string, string> = {
    'SD Backpack': 'e54', 'SD Bike Light': 'e66', 'SD Fleece': 'e90',
    'OH edit row 444444': 'e288', 'OH delete row 444444': 'e290',
  };
  for (const [label, nodes, role, name, near] of cases) {
    it(label, () => {
      const cands = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.role === role && x.n.name === name && x.n.ref);
      const hits = resolveByNear(nodes, cands.map((c) => c.i), near);
      expect(hits).toEqual([refOf(nodes, want[label])]);
    });
  }
});

describe('deriveNear — round-trip + durability + honest limit', () => {
  const trip = (nodes: ReturnType<typeof parseSnapshot>, role: string, name: string, ref: string) => {
    const ci = refOf(nodes, ref);
    const near = deriveNear(nodes, ci, role, name);
    expect(near).not.toBeNull();
    const cands = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.role === role && x.n.name === name && x.n.ref).map((c) => c.i);
    expect(resolveByNear(nodes, cands, near!)).toEqual([ci]);  // resolves back to ITSELF
  };
  it('SD products round-trip to their own button', () => {
    trip(sd, 'button', 'Add to cart', 'e54');
    trip(sd, 'button', 'Add to cart', 'e66');
    trip(sd, 'button', 'Add to cart', 'e90');
  });
  it('OH edit/delete round-trip', () => {
    trip(oh, 'button', EDIT, 'e288');
    trip(oh, 'button', DEL, 'e290');
  });
  it('D3 — derives a DURABLE id-like anchor, not the free-text first name', () => {
    const near = deriveNear(oh, refOf(oh, 'e288'), 'button', EDIT);
    expect(near).toMatch(/\d{3,}/);   // an id, not "dfgsjsjdh"
  });
  it('S3 — content-identical rows are unresolvable (deriveNear=null), never wrong-resolved', () => {
    const editIdxs = oh.map((n, i) => ({ n, i })).filter((x) => x.n.role === 'button' && x.n.name === EDIT && x.n.ref).map((x) => x.i);
    const nulls = editIdxs.filter((ci) => deriveNear(oh, ci, 'button', EDIT) === null);
    expect(nulls.length).toBeGreaterThan(0);
  });
  it('returns null for an element already unique by role+name', () => {
    // a button whose (role,name) is unique → no near needed
    const uniq = sd.find((n) => n.role === 'button' && n.name === 'Open Menu');
    if (uniq) expect(deriveNear(sd, sd.indexOf(uniq), 'button', 'Open Menu')).toBeNull();
  });
});

describe('nearStability', () => {
  it('scores id-like text above free-text prose', () => {
    expect(nearStability('123445 34')).toBeGreaterThan(nearStability('dfgsjsjdh'));
    expect(nearStability('444444')).toBeGreaterThan(nearStability('John Smith'));
  });
});
