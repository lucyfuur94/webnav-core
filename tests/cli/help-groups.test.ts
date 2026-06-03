import { describe, it, expect } from 'vitest';
import { topLevelHelp } from '../../src/cli-help.js';

describe('grouped top-level help', () => {
  const h = topLevelHelp();

  it('shows the group headers', () => {
    expect(h).toMatch(/^Find:/m);
    expect(h).toMatch(/^Read:/m);
    expect(h).toMatch(/^Navigate:/m);
  });

  it('lists locate under Find and recall under Read (ordering)', () => {
    const findIdx = h.indexOf('Find:');
    const readIdx = h.indexOf('Read:');
    const navIdx = h.indexOf('Navigate:');
    // Match the indented COMMAND lines (2-space prefix), not the tagline which
    // also mentions "locate"/"recall".
    const locateIdx = h.indexOf('  locate ');
    const recallIdx = h.indexOf('  recall ');
    expect(findIdx).toBeGreaterThanOrEqual(0);
    expect(locateIdx).toBeGreaterThan(findIdx);
    expect(locateIdx).toBeLessThan(readIdx);
    expect(recallIdx).toBeGreaterThan(readIdx);
    expect(recallIdx).toBeLessThan(navIdx);
  });

  it('eval and network appear under Navigate', () => {
    const navIdx = h.indexOf('Navigate:');
    const evalIdx = h.indexOf('  eval ');
    const netIdx = h.indexOf('  network ');
    expect(evalIdx).toBeGreaterThan(navIdx);
    expect(netIdx).toBeGreaterThan(navIdx);
  });

  it('still points at the dev namespace', () => {
    expect(h).toContain('webnav dev');
  });
});
