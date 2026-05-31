import { describe, it, expect } from 'vitest';
import { extractContent } from '../../src/router/extract-content.js';

const SCHEDULE = [
  '- link "Skip to content" [ref=e1]',
  '- heading "Schedule" [ref=e2]',
  '- cell "MURPH: 6:00 AM (CrossFit East River)" [ref=e3]',
  '- cell "Yoga: 9:00 AM (CrossFit East River)" [ref=e4]',
  '- paragraph "Join our early morning classes before work." [ref=e5]',
].join('\n');

describe('extractContent', () => {
  it('pulls readable content and drops nav chrome', () => {
    const ev = extractContent(SCHEDULE, 'https://x/schedule');
    expect(ev.url).toBe('https://x/schedule');
    expect(ev.text).toContain('Schedule');
    expect(ev.text).toContain('MURPH: 6:00 AM');
    expect(ev.text).not.toContain('Skip to content'); // chrome dropped
  });

  it('surfaces query-relevant lines', () => {
    const ev = extractContent(SCHEDULE, 'https://x', ['6:00', 'am']);
    expect(ev.relevant.some((l) => l.includes('6:00 AM'))).toBe(true);
    // a non-matching content line is not in relevant
    expect(ev.relevant.some((l) => l.includes('Yoga: 9:00 AM'))).toBe(true); // matches "am"
  });

  it('returns empty relevant when no query terms', () => {
    expect(extractContent(SCHEDULE, 'https://x').relevant).toEqual([]);
  });

  it('caps text length for compactness', () => {
    const huge = Array.from({length: 5000}, (_, i) => `- paragraph "line ${i} with some words" [ref=e${i}]`).join('\n');
    const ev = extractContent(huge, 'https://x');
    expect(ev.text.length).toBeLessThanOrEqual(4200); // capped ~4000
  });
});
