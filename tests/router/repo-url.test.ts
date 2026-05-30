import { describe, it, expect } from 'vitest';
import { repoUrl, isRepoLink } from '../../src/router/router.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

function link(yml: string) { return parseSnapshot(yml)[0]; }

describe('repoUrl (recognize GitHub repo result links — real DOM shapes)', () => {
  it('resolves a RELATIVE /owner/repo result link to absolute (GitHub search shape)', () => {
    // Real GitHub search results emit: link "owner/repo" with /url: /owner/repo
    const n = link('- link "hashicorp/go-retryablehttp" [ref=e1]:\n    - /url: /hashicorp/go-retryablehttp');
    expect(repoUrl(n)).toBe('https://github.com/hashicorp/go-retryablehttp');
  });

  it('accepts an ABSOLUTE owner/repo url', () => {
    const n = link('- link "tenacity" [ref=e1]:\n    - /url: https://github.com/jd/tenacity');
    expect(repoUrl(n)).toBe('https://github.com/jd/tenacity');
  });

  it('rejects sub-paths like /owner/repo/issues', () => {
    const n = link('- link "issues" [ref=e1]:\n    - /url: /jd/tenacity/issues');
    expect(repoUrl(n)).toBeNull();
  });

  it('rejects non-repo top-level paths (sponsors, search, etc.)', () => {
    const a = link('- link "x" [ref=e1]:\n    - /url: https://github.com/sponsors/explore');
    const b = link('- link "y" [ref=e2]:\n    - /url: /search/advanced');
    expect(repoUrl(a)).toBeNull();
    expect(repoUrl(b)).toBeNull();
  });

  it('rejects non-link nodes and bare github.com', () => {
    expect(repoUrl(link('- heading "jd/tenacity" [ref=e1]'))).toBeNull();
    expect(repoUrl(link('- link "home" [ref=e1]:\n    - /url: https://github.com'))).toBeNull();
  });

  it('isRepoLink is the boolean form of repoUrl', () => {
    const n = link('- link "a/b" [ref=e1]:\n    - /url: /a/b');
    expect(isRepoLink(n)).toBe(true);
    expect(isRepoLink(link('- link "x" [ref=e1]:\n    - /url: /sponsors/x'))).toBe(false);
  });
});
