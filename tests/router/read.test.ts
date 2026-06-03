import { describe, it, expect } from 'vitest';
import { readUrl } from '../../src/router/read.js';

const READY = `
- heading "Example Domain" [ref=e1]
- paragraph "This domain is for use in illustrative examples." [ref=e2]
- paragraph "More information..." [ref=e3]
- link "More information" [ref=e4]
- heading "Section" [ref=e5]
- paragraph "Body text here for content." [ref=e6]
- list "items" [ref=e7]
- paragraph "Another line of readable content." [ref=e8]`;

const INTERSTITIAL = `
- heading "Just a moment..." [ref=e1]
- paragraph "Checking your browser before accessing." [ref=e2]`;

describe('readUrl', () => {
  it('returns distilled content for a ready page', async () => {
    const r = await readUrl('https://example.com', async () => READY);
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.url).toBe('https://example.com');
    expect(r.content.text).toContain('illustrative examples');
  });

  it('escalates (blocked) on an interstitial — never evades', async () => {
    const r = await readUrl('https://example.com', async () => INTERSTITIAL);
    expect(r.status).toBe('blocked');
  });

  it('--raw returns the full snapshot instead of distilled content', async () => {
    const r = await readUrl('https://example.com', async () => READY, { raw: true });
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.raw).toBe(READY);
  });
});
