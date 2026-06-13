import { describe, it, expect } from 'vitest';
import { commandHelp } from '../../src/cli-help.js';

describe('per-verb help teaches data-flow', () => {
  it('walk help points at dev graph-show for the start/goal state ids', () => {
    expect(commandHelp('walk')).toMatch(/graph-show/);
  });
  it('walk-resume help explains answering the fork', () => {
    expect(commandHelp('walk-resume')).toMatch(/fork|ref|classify/i);
  });
  it('snapshot help points at reading refs from the snapshot', () => {
    expect(commandHelp('snapshot')).toMatch(/ref/i);
  });
});
