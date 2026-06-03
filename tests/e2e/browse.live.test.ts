import { describe, it, expect } from 'vitest';
import { runEval } from '../../src/router/browse.js';

const LIVE = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!LIVE)('browse primitives (live)', () => {
  it('eval returns a targeted value off a live page', async () => {
    const r = await runEval('https://github.com/psf/requests', '() => document.title');
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.value.toLowerCase()).toContain('requests');
  }, 60000);
});
