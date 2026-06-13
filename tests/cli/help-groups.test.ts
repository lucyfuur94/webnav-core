import { describe, it, expect } from 'vitest';
import { topLevelHelp } from '../../src/cli-help.js';

describe('grouped top-level help', () => {
  const h = topLevelHelp();

  it('shows the surviving group headers (Find is now empty and omitted)', () => {
    // The `find` group (locate/route/list-goals) was removed with the
    // internet-graph surface, so no Find header is rendered.
    expect(h).not.toMatch(/^Find:/m);
    expect(h).toMatch(/^Read:/m);
    expect(h).toMatch(/^Navigate:/m);
  });

  it('lists read/search under Read, before Navigate (ordering)', () => {
    const readIdx = h.indexOf('Read:');
    const navIdx = h.indexOf('Navigate:');
    // Match the indented COMMAND lines (2-space prefix).
    const readCmdIdx = h.indexOf('  read ');
    const searchIdx = h.indexOf('  search ');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(readCmdIdx).toBeGreaterThan(readIdx);
    expect(searchIdx).toBeGreaterThan(readIdx);
    expect(readCmdIdx).toBeLessThan(navIdx);
    expect(searchIdx).toBeLessThan(navIdx);
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
