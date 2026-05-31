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

  // Regression (found by DOGFOODING `webnav search`): short chrome nav links
  // ("git repository" -> the engine's source repo, "CC-BY-SA 4.0" -> license)
  // leaked in as results. Real results have multi-word titles; chrome labels
  // are 1-2 words and/or point at known chrome URLs.
  it('drops short chrome nav links, keeps multi-word result titles', () => {
    const yml = [
      '- link "git repository" [ref=e1]:',                       // 2 words + chrome url
      '    - /url: https://github.com/MarginaliaSearch/marginalia',
      '- link "CC-BY-SA 4.0" [ref=e2]:',                          // license footer
      '    - /url: https://creativecommons.org/licenses/by-sa/4.0/',
      '- link "About" [ref=e3]:',                                 // 1-word nav
      '    - /url: https://example.org/about',
      '- link "ICLR GPT-4V is a Generalist Web Agent if Grounded" [ref=e4]:',  // real result
      '    - /url: https://iclr.cc/virtual/2024/22163',
    ].join('\n');
    expect(parseSearchResults(yml, 10).map((x) => x.url)).toEqual(['https://iclr.cc/virtual/2024/22163']);
  });
});
