import { describe, it, expect } from 'vitest';
import { delayFor, hostOf } from '../../src/playwright/throttle.js';

describe('delayFor (per-host politeness — pure)', () => {
  it('returns the remaining wait when within the interval', () => {
    expect(delayFor(1000, 1200, 500)).toBe(300);   // last=1000, now=1200, interval=500 → wait 300
  });
  it('returns 0 once the interval has elapsed', () => {
    expect(delayFor(1000, 1600, 500)).toBe(0);
    expect(delayFor(1000, 1500, 500)).toBe(0);      // exactly at the boundary
  });
  it('returns 0 for a never-seen host (last=null)', () => {
    expect(delayFor(null, 5000, 500)).toBe(0);
  });
  it('returns 0 when the interval is disabled (<=0)', () => {
    expect(delayFor(1000, 1000, 0)).toBe(0);
  });
});

describe('hostOf (safe host extraction — never throws)', () => {
  it('extracts the host from a real URL', () => {
    expect(hostOf('https://www.saucedemo.com/inventory.html')).toBe('www.saucedemo.com');
  });
  it('returns null for glob urlPatterns / about:blank / garbage (skip the throttle)', () => {
    expect(hostOf('*inventory*')).toBeNull();
    expect(hostOf('about:blank')).toBeNull();
    expect(hostOf('')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });
});
