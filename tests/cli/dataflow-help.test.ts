import { describe, it, expect } from 'vitest';
import { commandHelp } from '../../src/cli-help.js';

describe('per-verb help teaches data-flow', () => {
  it('recall help points at list-goals for the goal id', () => {
    expect(commandHelp('recall')).toMatch(/list-goals/);
  });
  it('read help points at locate for the url', () => {
    expect(commandHelp('read')).toMatch(/locate/);
  });
  it('hop help says the url is the current page', () => {
    expect(commandHelp('hop')).toMatch(/current/i);
  });
});
