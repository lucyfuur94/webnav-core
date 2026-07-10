import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Pins the settled 2026-07-10 guideline: inference must be site-agnostic.
// A site name appearing in src/ means someone re-introduced a site-tuned rule.
const EXEMPT = /src\/seed/;   // shipped example DATA (saucedemo default seed) is not a rule
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
describe('core guidelines (settled 2026-07-10)', () => {
  const files = tsFiles('src').filter((p) => !EXEMPT.test(p));
  it('no site-specific names in src/', () => {
    const SITES = /the analytics SPA|orangehrm|analytics\.mn|automationexercise/i;
    for (const p of files) expect(SITES.test(readFileSync(p, 'utf8')), p).toBe(false);
  });
  it('no site-shaped one-shot heuristics (deleted 2026-07-10)', () => {
    const BANNED = [/records?\s+found/i, /\bID_SEG\b/, /subTabContainer/];
    for (const p of files) for (const re of BANNED) expect(re.test(readFileSync(p, 'utf8')), `${p} ~ ${re}`).toBe(false);
  });
});
