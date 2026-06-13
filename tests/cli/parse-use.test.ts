import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — use dispatcher', () => {
  it('use read parses the same as bare read', () => {
    expect(parseArgs(['use', 'read', 'https://x.com'])).toEqual(parseArgs(['read', 'https://x.com']));
  });
  it('use search parses the same as bare search', () => {
    expect(parseArgs(['use', 'search', 'rust orm'])).toEqual(parseArgs(['search', 'rust orm']));
  });
  it('use --help shows use help', () => {
    expect(parseArgs(['use', '--help'])).toEqual({ cmd: 'use-help' });
  });
});
