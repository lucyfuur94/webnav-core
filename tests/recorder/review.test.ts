import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseShowinfoTimes, buildReviewPrompt, frameSelectExpr, extractFrames } from '../../src/recorder/review.js';

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
  it('prompt includes known assembly drops so the LLM hunts only sensor blindness', () => {
    const p = buildReviewPrompt('s', [], [], [], undefined, false,
      [{ seq: 1, kind: 'click', label: 'Chart type', reason: 'unresolved-same-page' }]);
    expect(p).toContain('ASSEMBLY DROPS (already known');
    expect(p).toContain('Chart type');
  });
  it('prompt includes a LANDING STRUCTURE section when structure is passed', () => {
    const p = buildReviewPrompt('s', [], [], [], undefined, false, undefined,
      [{ url: 'https://x.com/a', named: 3, nameless: 5 }]);
    expect(p).toContain('LANDING STRUCTURE (named vs NAMELESS interactive controls per page — many nameless controls = a sensor gap; compare against what the frames show)');
    expect(p).toContain('https://x.com/a');
    expect(p).toContain('named: 3');
    expect(p).toContain('nameless: 5');
  });
  it('omits the section entirely when no structure is passed', () => {
    const p = buildReviewPrompt('s', [], [], []);
    expect(p).not.toContain('LANDING STRUCTURE');
  });
});


describe('frameSelectExpr (web-UI tuned selection)', () => {
  it('heartbeat guarantees full-timeline coverage; min-gap rate-limits bursts', () => {
    const { expr, heartbeatS, minGapS } = frameSelectExpr(584, 20);   // the real 10-min take
    expect(heartbeatS).toBe(39);            // ceil(584 / (20*0.75)) — tail not cut off by scene bursts
    expect(minGapS).toBe(13);
    expect(expr).toContain('isnan(prev_selected_t)');   // first frame always
    expect(expr).toContain('scene');                     // change-driven
    expect(expr).toContain('gte(t-prev_selected_t');     // heartbeat + rate limit
  });
  it('short/unknown-duration videos get sane floors', () => {
    const { heartbeatS, minGapS } = frameSelectExpr(0, 20);
    expect(heartbeatS).toBe(5);
    expect(minGapS).toBe(2);
  });
});

describe('extractFrames (true-start reconstruction)', () => {
  // BUG: take-<ts>.webm's <ts> is the STOP time (written by videoStop), not the
  // start. A frame's wall-clock time must be reconstructed as
  // (stop - ffprobe duration) + pts, not (stop + pts) — else every frame is
  // offset forward by the whole clip duration.
  it('derives frame time from stop-minus-duration-plus-pts, not stop-plus-pts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webnav-review-test-'));
    const framesDir = join(dir, 'frames');
    try {
      const fakeExec = (async (cmd: string) => {
        if (cmd === 'ffprobe') return { stdout: '120', stderr: '' }; // duration = 120s
        // ffmpeg: report one selected frame at pts_time 5.0, and actually write it
        // so extractFrames' readdirSync sees a file.
        mkdirSync(framesDir, { recursive: true });
        writeFileSync(join(framesDir, 'f-001.png'), '');
        return { stdout: '', stderr: '[Parsed_showinfo_1 @ 0x1] n:0 pts:150 pts_time:5.0 ...' };
      }) as unknown as Parameters<typeof extractFrames>[4];

      const stopMs = 1_000_000; // take-1000000.webm
      const frames = await extractFrames(
        join(dir, 'take-1000000.webm'), stopMs, framesDir, 20, fakeExec,
      );

      expect(frames).toHaveLength(1);
      // start = stop - duration = 1_000_000 - 120_000 = 880_000; + pts 5s = 885_000
      expect(frames[0].atMs).toBe(885_000);
      expect(frames[0].atMs).not.toBe(stopMs + 5000); // guards against the old (wrong) stop+pts math
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
