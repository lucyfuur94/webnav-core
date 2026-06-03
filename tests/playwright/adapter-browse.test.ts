import { describe, it, expect } from 'vitest';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';

function recordingAdapter() {
  const calls: string[][] = [];
  const run = async (args: string[]) => { calls.push(args); return 'OUT'; };
  const a = new PlaywrightAdapter('t', run, () => '');
  return { a, calls };
}

describe('adapter browse methods', () => {
  it('evalJs passes the js expression to playwright-cli eval', async () => {
    const { a, calls } = recordingAdapter();
    const out = await a.evalJs('() => document.title');
    expect(out).toBe('OUT');
    expect(calls[0]).toEqual(['-s=t', 'eval', '() => document.title']);
  });
  it('network calls the network verb', async () => {
    const { a, calls } = recordingAdapter();
    await a.network();
    expect(calls[0]).toEqual(['-s=t', 'network']);
  });
  it('goBack and reload call their verbs', async () => {
    const { a, calls } = recordingAdapter();
    await a.goBack();
    await a.reload();
    expect(calls[0]).toEqual(['-s=t', 'go-back']);
    expect(calls[1]).toEqual(['-s=t', 'reload']);
  });
});
