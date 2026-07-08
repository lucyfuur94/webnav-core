import { describe, it, expect } from 'vitest';
import { makeVideoSync } from '../../src/playwright/video.js';

describe('makeVideoSync', () => {
  function harness() {
    const calls: string[] = [];
    const adapter = {
      videoStart: async () => { calls.push('start'); },
      videoStop: async (f: string) => { calls.push('stop:' + f); return true; },
    };
    const logs: string[] = [];
    const sync = makeVideoSync(() => adapter, {
      videosRoot: '/tmp/vids', log: (l) => logs.push(l), now: () => 111,
    });
    return { sync, calls, logs };
  }

  it('starts once per span, stops once, writes take-<ts>.webm', async () => {
    const { sync, calls } = harness();
    sync('s1', true); sync('s1', true);      // second start is a no-op
    await new Promise((r) => setImmediate(r));
    sync('s1', false); sync('s1', false);    // second stop is a no-op
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual(['start', 'stop:/tmp/vids/s1/take-111.webm']);
  });

  it('no adapter → no-op (never throws)', () => {
    const sync = makeVideoSync(() => null, { videosRoot: '/tmp/v', log: () => {}, now: () => 1 });
    expect(() => { sync('s', true); sync('s', false); }).not.toThrow();
  });
});
