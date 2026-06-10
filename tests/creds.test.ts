import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredStore } from '../src/creds.js';

const PATH = join(tmpdir(), `webnav-creds-test-${process.pid}.json`);

describe('CredStore', () => {
  beforeEach(() => { if (existsSync(PATH)) rmSync(PATH); });
  afterEach(() => { if (existsSync(PATH)) rmSync(PATH); });

  const store = () => new CredStore(PATH);

  it('set + get round-trips a site\'s credentials', () => {
    store().set('www.saucedemo.com', { username: 'standard_user', password: 'secret_sauce' });
    expect(store().get('www.saucedemo.com')).toEqual({ username: 'standard_user', password: 'secret_sauce' });
  });

  it('get returns {} for an unknown site', () => {
    expect(store().get('nope.com')).toEqual({});
  });

  it('set merges (existing keys kept, new added, dupes overwritten)', () => {
    const s = store();
    s.set('x.com', { username: 'a', password: 'p1' });
    s.set('x.com', { password: 'p2', zip: '12345' });
    expect(s.get('x.com')).toEqual({ username: 'a', password: 'p2', zip: '12345' });
  });

  it('writes the file with 0600 perms (owner-only)', () => {
    store().set('x.com', { username: 'a' });
    const mode = statSync(PATH).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('list returns sites + KEY NAMES only, never values', () => {
    const s = store();
    s.set('b.com', { username: 'u', password: 'secret' });
    s.set('a.com', { token: 't' });
    const listed = s.list();
    expect(listed).toEqual([
      { site: 'a.com', keys: ['token'] },
      { site: 'b.com', keys: ['password', 'username'] },
    ]);
    // no value leaked into the listing
    expect(JSON.stringify(listed)).not.toContain('secret');
  });

  it('remove deletes one key, then the whole site when empty', () => {
    const s = store();
    s.set('x.com', { username: 'u', password: 'p' });
    expect(s.remove('x.com', 'password')).toBe(true);
    expect(s.get('x.com')).toEqual({ username: 'u' });
    expect(s.remove('x.com', 'username')).toBe(true);
    expect(s.list()).toEqual([]);                 // site auto-removed when last key gone
    expect(s.remove('x.com')).toBe(false);        // already gone
  });

  it('remove of a whole site', () => {
    const s = store();
    s.set('x.com', { username: 'u' });
    expect(s.remove('x.com')).toBe(true);
    expect(s.get('x.com')).toEqual({});
  });
});
