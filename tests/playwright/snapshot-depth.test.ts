import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

describe('parseSnapshot — depth', () => {
  it('captures indentation depth (leading-space count of the raw line)', () => {
    // two-space-per-level YAML-ish; depth is the raw leading-space count
    const yml = [
      '- generic [ref=e1]:',
      '  - button "A" [ref=e2]',
      '    - generic "x" [ref=e3]',
    ].join('\n');
    const nodes = parseSnapshot(yml);
    expect(nodes.map((n) => [n.ref, n.depth])).toEqual([['e1', 0], ['e2', 2], ['e3', 4]]);
  });

  it('matches the real saucedemo fixture structure (card at 6, button at 12)', () => {
    const nodes = parseSnapshot(readFileSync(join(FIX, 'saucedemo-inventory.yml'), 'utf8'));
    const card = nodes.find((n) => n.ref === 'e43')!;     // the product card
    const button = nodes.find((n) => n.ref === 'e54')!;   // first Add-to-cart
    expect(card.depth).toBe(6);
    expect(button.depth).toBe(12);
  });
});
