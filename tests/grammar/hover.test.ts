// Grammar suite — HOVER / RIGHT-CLICK REVEAL group (X2).
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
// The draft decides reveal-vs-mutate purely from the effect's OBSERVED diff, never from
// the action's kind — so a hover-marked (or rightClick-marked) same-page effect with an
// added interactive subtree must produce the SAME reveal affordance as a click reveal.
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const B = 'https://mega.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

// A landing with a mega-nav trigger whose flyout only exists on hover.
const HOME = ['- heading "Home" [ref=e1]', '- banner [ref=e2]:', '  - button "Products" [ref=e3]', '  - link "Docs" [ref=e4]',
  '- main [ref=e5]:', '  - heading "Dashboard" [ref=e6]', '  - button "New" [ref=e7]',
  '- paragraph "Welcome" [ref=e9]', '- paragraph "Company" [ref=e10]'].join('\n');
const FLYOUT_ADDED = ['- menu "Products menu" [ref=e20]', '- link "Widgets" [ref=e21]', '- link "Gadgets" [ref=e22]'];
const HOME_FLYOUT = [HOME, ...FLYOUT_ADDED].join('\n');

const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
  toUrl: `${B}/app/home`, toSnapshot: HOME, navigated: true, diff: { added: [], removed: [] } as any };

const addedDiff = () => ({ added: parseSnapshot(FLYOUT_ADDED.join('\n')).map((n) => ({ ...n, depth: 0 })), removed: [] }) as any;

describe('grammar: X2 hover-revealed mega-menu → reveal affordance with children', () => {
  const hover: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/app/home`, fromSnapshot: HOME,
    action: { role: 'button', name: 'Products', ref: 'e3', hover: true, elementFp: { role: 'button', name: 'Products', near: null } } as any,
    toUrl: `${B}/app/home`, toSnapshot: HOME_FLYOUT, navigated: false, diff: addedDiff() };

  it('a hover-marked same-page effect with an added subtree classifies as REVEAL, not mutate', () => {
    const g = draftFromEffects([enter, hover] as never);
    const s = g.states.find((x) => x.label === 'app-home')!;
    const aff = s.affordances.find((a) => a.label === 'Products')!;
    expect(aff).toBeTruthy();
    expect(aff.kind).toBe('reveal');
    expect((aff.children ?? []).some((c) => c.label === 'Widgets')).toBe(true);
    expect((aff.children ?? []).some((c) => c.label === 'Gadgets')).toBe(true);
  });
});

describe('grammar: X2 right-click context menu → reveal affordance with children', () => {
  const rclick: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/app/home`, fromSnapshot: HOME,
    action: { role: 'button', name: 'Products', ref: 'e3', rightClick: true, elementFp: { role: 'button', name: 'Products', near: null } } as any,
    toUrl: `${B}/app/home`, toSnapshot: HOME_FLYOUT, navigated: false, diff: addedDiff() };

  it('a rightClick-marked same-page effect with an added subtree classifies as REVEAL (same branch as hover/click)', () => {
    const g = draftFromEffects([enter, rclick] as never);
    const s = g.states.find((x) => x.label === 'app-home')!;
    const aff = s.affordances.find((a) => a.label === 'Products')!;
    expect(aff).toBeTruthy();
    expect(aff.kind).toBe('reveal');
    expect((aff.children ?? []).some((c) => c.label === 'Widgets')).toBe(true);
  });
});

describe('grammar: X2 honest omission — no hover recorded, no flyout affordance', () => {
  it('without a recorded hover/right-click, the trigger reveals nothing and the flyout children are absent', () => {
    const g = draftFromEffects([enter] as never);
    const s = g.states.find((x) => x.label === 'app-home')!;
    const aff = s.affordances.find((a) => a.label === 'Products');
    // nothing was recorded for Products → no reveal, no invented children
    expect(aff?.kind === 'reveal').toBe(false);
    expect(s.affordances.some((a) => a.label === 'Widgets')).toBe(false);
    expect(s.affordances.some((a) => a.label === 'Gadgets')).toBe(false);
  });
});
