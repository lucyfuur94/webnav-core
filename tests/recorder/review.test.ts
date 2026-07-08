import { describe, it, expect } from 'vitest';
import { parseShowinfoTimes, buildReviewPrompt } from '../../src/recorder/review.js';

describe('parseShowinfoTimes', () => {
  it('pulls pts seconds in order from ffmpeg stderr', () => {
    const stderr = `[Parsed_showinfo_1 @ 0x1] n:0 pts:0 pts_time:0 ...
[Parsed_showinfo_1 @ 0x1] n:1 pts:1234 pts_time:12.34 ...
[Parsed_showinfo_1 @ 0x1] n:2 pts:9999 pts_time:37.5 ...`;
    expect(parseShowinfoTimes(stderr)).toEqual([0, 12.34, 37.5]);
  });
  it('empty stderr → no times', () => { expect(parseShowinfoTimes('')).toEqual([]); });
});

describe('buildReviewPrompt', () => {
  it('carries steps (with values), logs, frame paths+times, and the gap question', () => {
    const p = buildReviewPrompt('s-1',
      [{ seq: 1, kind: 'input', label: 'City', value: 'Pune', capturedAt: 1000 }],
      [{ t: 2000, line: 'skip: unresolved same-page click seq 3' }],
      [{ path: '/x/f-001.png', atMs: 1500 }]);
    expect(p).toContain('City');
    expect(p).toContain('= "Pune"');                       // recorded variable is audit input
    expect(p).toContain('skip: unresolved same-page click'); // honest skips are evidence
    expect(p).toContain('/x/f-001.png');
    expect(p).toContain('CAPTURE GAPS');                   // the deliverable
    expect(p).toContain('Read tool');                      // instructs image reading
  });
  it('is honest when there is nothing to review', () => {
    const p = buildReviewPrompt('s-2', [], [], []);
    expect(p).toContain('(no steps captured)');
    expect(p).toContain('(no frames extracted)');
  });
});
