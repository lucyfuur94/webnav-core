import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredStore, categorize } from '../src/creds.js';

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

  // ---- categorization (login / personal / other) ----

  it('categorize infers login, personal, and other from key names', () => {
    expect(categorize('username')).toBe('login');
    expect(categorize('password')).toBe('login');
    expect(categorize('email')).toBe('login');
    expect(categorize('firstName')).toBe('personal');
    expect(categorize('zip')).toBe('personal');
    expect(categorize('phone')).toBe('personal');
    expect(categorize('somethingElse')).toBe('other');
  });

  it('listDetailed returns each key with an inferred category, never values', () => {
    const s = store();
    s.set('x.com', { username: 'u', password: 'secret', firstName: 'Test', misc: 'm' });
    const detailed = s.listDetailed();
    expect(detailed).toEqual([{ site: 'x.com', keys: [
      { name: 'firstName', category: 'personal' },
      { name: 'misc', category: 'other' },
      { name: 'password', category: 'login' },
      { name: 'username', category: 'login' },
    ]}]);
    expect(JSON.stringify(detailed)).not.toContain('secret');
  });

  it('set with an explicit category overrides inference', () => {
    const s = store();
    s.set('x.com', { token: 'abc' }, 'login');   // token would infer 'login' anyway; force 'other'
    s.set('x.com', { note: 'n' }, 'login');       // 'note' would be 'other' — force 'login'
    const d = s.listDetailed()[0].keys;
    expect(d.find(k => k.name === 'note')!.category).toBe('login');
  });

  it('a value-only update preserves the existing category', () => {
    const s = store();
    s.set('x.com', { apiKey: 'k1' }, 'personal');     // deliberately mis-categorized
    s.set('x.com', { apiKey: 'k2' });                  // value-only update, no category
    expect(s.get('x.com').apiKey).toBe('k2');
    expect(s.listDetailed()[0].keys[0].category).toBe('personal');  // category kept
  });

  it('setCategory changes only the category, leaving the value intact', () => {
    const s = store();
    s.set('x.com', { username: 'u' });
    expect(s.setCategory('x.com', 'username', 'other')).toBe(true);
    expect(s.get('x.com').username).toBe('u');
    expect(s.listDetailed()[0].keys[0].category).toBe('other');
    expect(s.setCategory('x.com', 'nope', 'other')).toBe(false);
  });

  it('reads LEGACY bare-string entries and normalizes them (backward compat)', () => {
    // simulate an old credentials.json: { site: { key: "value" } }
    writeFileSync(PATH, JSON.stringify({ 'old.com': { username: 'legacy_user', password: 'legacy_pass' } }), { mode: 0o600 });
    const s = store();
    expect(s.get('old.com')).toEqual({ username: 'legacy_user', password: 'legacy_pass' });
    expect(s.listDetailed()).toEqual([{ site: 'old.com', keys: [
      { name: 'password', category: 'login' },
      { name: 'username', category: 'login' },
    ]}]);
    // once re-written, entries are upgraded to the {value,category} shape
    s.set('old.com', { username: 'new_user' });
    const onDisk = JSON.parse(readFileSync(PATH, 'utf8'));
    expect(onDisk['old.com'].username).toEqual({ value: 'new_user', category: 'login' });
  });
});
