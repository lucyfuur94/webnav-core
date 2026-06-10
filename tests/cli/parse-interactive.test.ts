import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — interactive verbs', () => {
  it('parses navigate', () => {
    expect(parseArgs(['navigate', 'https://x.com', '--session', 's1']))
      .toEqual({ cmd: 'navigate', url: 'https://x.com', session: 's1', browser: { headed: true } });
  });
  it('parses snapshot', () => {
    expect(parseArgs(['snapshot', '--session', 's1'])).toEqual({ cmd: 'snapshot', session: 's1' });
  });
  it('parses click', () => {
    expect(parseArgs(['click', 'e42', '--session', 's1']))
      .toEqual({ cmd: 'click', ref: 'e42', session: 's1' });
  });
  it('parses type with ref + text', () => {
    expect(parseArgs(['type', 'e1', 'standard_user', '--session', 's1']))
      .toEqual({ cmd: 'type', ref: 'e1', text: 'standard_user', session: 's1' });
  });
  it('routes under the use dispatcher', () => {
    expect(parseArgs(['use', 'click', 'e42', '--session', 's1']))
      .toEqual(parseArgs(['click', 'e42', '--session', 's1']));
  });
});
