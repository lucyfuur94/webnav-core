import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — walk verbs', () => {
  it('parses walk with start/goal and repeated --input', () => {
    expect(parseArgs(['walk', '--start', 'sd:login', '--goal', 'sd:checkout-overview',
      '--input', 'username=u', '--input', 'password=p'])).toEqual({
      cmd: 'walk', start: 'sd:login', goal: 'sd:checkout-overview',
      inputs: { username: 'u', password: 'p' }, browser: { headed: true },
    });
  });
  it('parses walk-resume with --ref', () => {
    expect(parseArgs(['walk-resume', 'walk-7', '--ref', 'e42']))
      .toEqual({ cmd: 'walk-resume', session: 'walk-7', ref: 'e42', classify: undefined });
  });
  it('parses walk-resume with --classify', () => {
    expect(parseArgs(['walk-resume', 'walk-7', '--classify', 'safe']))
      .toEqual({ cmd: 'walk-resume', session: 'walk-7', ref: undefined, classify: 'safe' });
  });
  it('routes walk under the use dispatcher', () => {
    expect(parseArgs(['use', 'walk', '--start', 'a', '--goal', 'b']))
      .toEqual(parseArgs(['walk', '--start', 'a', '--goal', 'b']));
  });
});
