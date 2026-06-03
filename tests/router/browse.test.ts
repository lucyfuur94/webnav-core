import { describe, it, expect } from 'vitest';
import { runEval, runNetwork } from '../../src/router/browse.js';

function fakeAdapter(outputs: Record<string, string>) {
  return {
    open: async () => '',
    evalJs: async (_f: string) => outputs.eval ?? '',
    network: async () => outputs.network ?? '',
    close: async () => '',
  } as any;
}

describe('runEval', () => {
  it('returns the page eval value', async () => {
    const r = await runEval('https://example.com', '() => 42', fakeAdapter({ eval: '42' }));
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.value).toBe('42');
    expect(r.url).toBe('https://example.com');
  });
  it('maps an open/eval error to failed', async () => {
    const bad = { open: async () => { throw new Error('boom'); }, close: async () => '' } as any;
    const r = await runEval('https://x', '() => 1', bad);
    expect(r.status).toBe('failed');
  });

  it('extracts just the value from playwright-cli wrapper noise', async () => {
    // playwright-cli wraps the value in `### Result\n<value>\n### Ran...` chrome;
    // runEval should surface only the value, not the wrapper.
    const wrapped = [
      '### Result',
      '"Example Domain"',
      '### Ran Playwright code',
      '```js',
      "await page.evaluate('() => document.title');",
      '```',
    ].join('\n');
    const r = await runEval('https://example.com', '() => document.title', fakeAdapter({ eval: wrapped }));
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.value).toBe('Example Domain'); // unwrapped + JSON-decoded
  });
});

describe('runNetwork', () => {
  it('returns the raw network output', async () => {
    const r = await runNetwork('https://example.com', fakeAdapter({ network: 'GET https://api/x 200' }));
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.requests).toContain('api/x');
  });
});
