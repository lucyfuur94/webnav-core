import { describe, it, expect } from 'vitest';
import { lockHolderPid, prepProfileWith } from '../../src/playwright/profile-lock.js';

describe('lockHolderPid', () => {
  it('parses the pid off a SingletonLock target; rejects junk', () => {
    expect(lockHolderPid('MMMDVDIKSHANTY-38690')).toBe(38690);
    expect(lockHolderPid('host-with-dashes-12')).toBe(12);
    expect(lockHolderPid('nolockpid')).toBe(null);
    expect(lockHolderPid('host-0')).toBe(null);
  });
});

describe('prepProfileWith', () => {
  it('kills a LIVE webnav-owned holder, then clears Singleton*', () => {
    const killed: number[] = []; const unlinked: string[] = [];
    prepProfileWith('/p/default', {
      readlink: () => 'host-999', isWebnavChrome: () => true,
      kill: (pid) => killed.push(pid), unlink: (f) => unlinked.push(f),
    });
    expect(killed).toEqual([999]);
    expect(unlinked).toEqual(['/p/default/SingletonLock', '/p/default/SingletonSocket', '/p/default/SingletonCookie']);
  });
  it('does NOT kill when the holder is not a webnav Chrome (e.g. the user real Chrome / dead pid)', () => {
    const killed: number[] = []; const unlinked: string[] = [];
    prepProfileWith('/p/default', {
      readlink: () => 'host-656', isWebnavChrome: () => false,   // real Chrome or dead → never kill
      kill: (pid) => killed.push(pid), unlink: (f) => unlinked.push(f),
    });
    expect(killed).toEqual([]);              // safety: never touch a non-webnav process
    expect(unlinked.length).toBe(3);        // but still clear the stale lock files
  });
  it('no lock present (readlink throws) → still clears (idempotent), no kill', () => {
    const killed: number[] = []; const unlinked: string[] = [];
    prepProfileWith('/p/x', {
      readlink: () => { throw new Error('ENOENT'); }, isWebnavChrome: () => true,
      kill: (pid) => killed.push(pid), unlink: (f) => unlinked.push(f),
    });
    expect(killed).toEqual([]);
    expect(unlinked.length).toBe(3);
  });
});
