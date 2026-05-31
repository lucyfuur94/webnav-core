import { describe, it, expect } from 'vitest';
import { parseSearchResults } from '../../src/router/search.js';

const RESULTS = [
  '- link "About" [ref=e1]:',
  '    - /url: https://search.marginalia.nu/about',          // chrome host -> excluded
  '- link "Team RWB honors Veterans Day at NYC CrossFit gym" [ref=e2]:',
  '    - /url: https://americanmilitarynews.com/2017/11/team-rwb/',  // real result
  '- link "https://americanmilitarynews.com/2017/11/team-rwb/" [ref=e3]:',
  '    - /url: https://americanmilitarynews.com/2017/11/team-rwb/',  // bare-url dup -> name===url, skip
  '- link "" [ref=e4]:',
  '    - /url: https://web.archive.org/web/*/https://americanmilitarynews.com/2017/11/team-rwb/', // archive -> excluded
  '- link "CrossFit East River - Official Site" [ref=e5]:',
  '    - /url: https://beastriver.com/',                       // real result
].join('\n');

describe('parseSearchResults', () => {
  it('keeps real external results, drops chrome/mirrors/bare-url dups', () => {
    const r = parseSearchResults(RESULTS, 10);
    expect(r.map((x) => x.url)).toEqual([
      'https://americanmilitarynews.com/2017/11/team-rwb/',
      'https://beastriver.com/',
    ]);
    expect(r[0].title).toMatch(/Team RWB/);
  });
  it('respects the limit', () => {
    expect(parseSearchResults(RESULTS, 1).length).toBe(1);
  });
  it('dedupes by url', () => {
    const r = parseSearchResults(RESULTS, 10);
    expect(new Set(r.map((x) => x.url)).size).toBe(r.length);
  });

  // Regression (found live): Marginalia surfaces an "About" link on its OTHER
  // host about.marginalia-search.com — must be excluded too (whole family), not
  // just search.marginalia.nu.
  it('excludes the whole Marginalia/archive host family, not one exact host', () => {
    const yml = [
      '- link "About Marginalia" [ref=e1]:',
      '    - /url: https://about.marginalia-search.com/',
      '- link "Real Result Page" [ref=e2]:',
      '    - /url: https://example.com/article',
      '- link "Archived copy" [ref=e3]:',
      '    - /url: https://web.archive.org/web/2020/https://example.com/x',
    ].join('\n');
    expect(parseSearchResults(yml, 10).map((x) => x.url)).toEqual(['https://example.com/article']);
  });
});
