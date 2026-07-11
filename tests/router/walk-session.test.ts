import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WalkSessionStore } from '../../src/router/walk-session.js';

function store(): WalkSessionStore {
  return WalkSessionStore.fromDatabase(new Database(':memory:'));
}

describe('WalkSessionStore', () => {
  it('creates a session and loads it back', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'c', path: ['a', 'b', 'c'], browserSession: 'walk-1', nowMs: 100 });
    const w = s.load(id)!;
    expect(w.startState).toBe('a');
    expect(w.goalState).toBe('c');
    expect(w.path).toEqual(['a', 'b', 'c']);
    expect(w.pos).toBe(0);
    expect(w.browserSession).toBe('walk-1');
    expect(w.status).toBe('paused');
  });

  it('advance updates the position', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'c', path: ['a', 'b', 'c'], browserSession: 'walk-1', nowMs: 1 });
    s.advance(id, 2);
    expect(s.load(id)!.pos).toBe(2);
  });

  it('close marks the session done and load returns null after', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', nowMs: 1 });
    s.close(id);
    expect(s.load(id)).toBeNull();
  });

  it('load of an unknown session is null', () => {
    expect(store().load('nope')).toBeNull();
  });

  it('never persists inputs (no such column)', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', nowMs: 1 });
    expect(Object.keys(s.load(id)!)).toEqual(
      expect.not.arrayContaining(['inputs', 'username', 'password']),
    );
  });

  // profile-status design item 2: walk-resume needs the ORIGINAL walk's profile to
  // rebuild matching BrowserOpts for a fresh-session SSO-wall retry.
  it('persists the profile and loads it back', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', profile: '/home/x/.webnav/profiles/acme', nowMs: 1 });
    expect(s.load(id)!.profile).toBe('/home/x/.webnav/profiles/acme');
  });

  it('a session with no profile loads back as undefined (no profile ⇒ no wall-retry capability)', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', nowMs: 1 });
    expect(s.load(id)!.profile).toBeUndefined();
  });

  // A wall retry may rotate to a brand-new browser session mid-walk; rebrowser
  // repoints the STABLE session_id at it so the next walk-resume reattaches right.
  it('rebrowser repoints a paused session at a new browser session, keeping the same session id', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'c', path: ['a', 'b', 'c'], browserSession: 'w-old', nowMs: 1 });
    s.rebrowser(id, 'w-new');
    const w = s.load(id)!;
    expect(w.sessionId).toBe(id);
    expect(w.browserSession).toBe('w-new');
  });
});
