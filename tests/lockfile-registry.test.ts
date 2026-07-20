import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUARD: this is a PUBLIC repo — package-lock.json must only reference the public npm
// registry. Dev machines on a corporate network resolve installs through an internal
// mirror (~/.npmrc registry override), and `npm install` then writes INTERNAL tarball
// URLs into the lockfile. CI runners can't reach that mirror, so `npm ci` hangs for
// ~8 minutes and dies with npm's "Exit handler never called!" (observed 2026-07-20,
// 104 contaminated entries). This test catches the contamination at commit time.
//
// If it fails after you add a dependency, rewrite the URLs back to the public registry:
//   python3 -c "p='package-lock.json'; s=open(p).read(); \
//     import re; s=re.sub(r'https://[^\"]*?/npm/[^\"]*?/((@[^/\"]+/)?[^/\"]+/-/)', r'https://registry.npmjs.org/\\1', s); \
//     open(p,'w').write(s)"
// (or replace your mirror's base URL with https://registry.npmjs.org/ — integrity
// hashes stay valid; the mirror serves upstream bytes.)
describe('package-lock.json registry hygiene', () => {
  it('every resolved URL points at registry.npmjs.org (no internal-mirror leakage)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const bad: string[] = [];
    for (const [name, entry] of Object.entries<Record<string, unknown>>(lock.packages ?? {})) {
      const resolved = entry.resolved as string | undefined;
      if (resolved && !resolved.startsWith('https://registry.npmjs.org/')) bad.push(name + ' -> ' + resolved);
    }
    expect(bad, 'internal/non-public registry URLs in package-lock.json:\n' + bad.join('\n')).toEqual([]);
  });
});
