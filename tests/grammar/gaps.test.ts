// Grammar suite — GAP-REPRO fixtures (rows verdict GAP, plus the top cross-cutting gap X1).
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
// Rule: these assert the CURRENT (honest-or-not) degradation. GAP rows are real engine gaps —
// they are not bugs to silently swallow; the test pins the observed behavior so a future fix
// (X1 etc.) is a deliberate, visible test change, not a silent regression.
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const B = 'https://gap.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://gap.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

// ── gx-undeclared-portal (row 26 — GAP, the #1-ranked cross-cutting gap X1) ─────────────────
// A role-less portal div (AntD-Popover/Bootstrap-dropdown style: no dialog/menu/listbox ARIA
// role at all) holds option-like children. insideOverlay() only recognizes ANCESTOR nodes whose
// role is in OVERLAY_ROLES — a role-less `generic` ancestor never satisfies that, so a click
// inside it is NOT gated as an overlay click. This is the TOP-RANKED gap (X1): in-overlay value
// clicks attribute to the page body — a data-pollution class, not merely an omission.
describe('grammar: 26 undeclared (role-less) portal overlay — GAP, pollution reproduced today', () => {
  const PAGE = [
    '- heading "Analytics" [ref=e1]',
    '- button "Publisher" [ref=e2]',    // opens a role-less popover (no dialog/menu role at all)
    '- button "Share" [ref=e3]',
    '- button "Run" [ref=e4]',
    '- paragraph "Report" [ref=e5]',
    '- paragraph "Draft" [ref=e6]',
    '- listitem "Row 1" [ref=e7]',
    '- listitem "Row 2" [ref=e8]',
  ].join('\n');
  // the opener click ADDS a role-less `generic` wrapper (NOT dialog/menu/listbox) holding
  // option-like value children — exactly the AntD Popover / Bootstrap `ul.dropdown-menu`
  // (without menu roles) shape the matrix names.
  const OPTION_LINES = ['  - checkbox "United States" [ref=e11]', '  - checkbox "United Kingdom" [ref=e12]', '  - checkbox "Canada" [ref=e13]'];
  const PAGE_OPEN = [PAGE, '- generic [ref=e10]:', ...OPTION_LINES].join('\n');
  const openPopover: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/report/9`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Publisher', ref: 'e2', elementFp: { role: 'button', name: 'Publisher', near: null } },
    toUrl: `${B}/report/9`, toSnapshot: PAGE_OPEN, navigated: false,
    diff: { added: parseSnapshot(OPTION_LINES.join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };
  // a value click INSIDE the role-less popover — FROM = PAGE_OPEN, so the checkbox is nested
  // under the role-less `generic`, NOT under any OVERLAY_ROLES ancestor.
  const clickValue: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${B}/report/9`, fromSnapshot: PAGE_OPEN,
    action: { role: 'checkbox', name: 'United States', ref: 'e11', elementFp: { role: 'checkbox', name: 'United States', near: null } },
    toUrl: `${B}/report/9`, toSnapshot: PAGE_OPEN, navigated: false, diff: { added: [], removed: [] } as any };

  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/report/9`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } as any };

  // MATRIX-MISMATCH is not the right label here — this IS the matrix's own documented GAP (row
  // 26 verdict: GAP, "none today"). We assert the FAILURE honestly, matching the matrix's own
  // framing ("today asserts the pollution failure honestly, after X1 asserts containment").
  it('reproduces the pollution: a value click inside a role-less portal DOES leak as a page affordance', () => {
    const g = draftFromEffects([enter, openPopover, clickValue] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    // insideOverlay finds no OVERLAY_ROLES ancestor (the wrapper is a bare `generic`) → the click
    // is NOT gated → "United States" leaks as an ordinary page-level affordance (the progneo bug).
    expect(s.affordances.some((a) => a.label === 'United States')).toBe(true);
  });

  it('the opener\'s children exclude the un-gated value options (enumeratedNames folds them, unlike X1\'s containment gap)', () => {
    const g = draftFromEffects([enter, openPopover] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    const opener = s.affordances.find((a) => a.label === 'Publisher')!;
    // enumeratedNames DOES catch this (>=3 same-role/depth siblings under the added subtree) —
    // so the checkbox VALUES are folded out of the opener's children by the flat depth-based
    // value-domain filter (a different, narrower mechanism than X1's proposed containment fix).
    // With zero surviving named children, the opener falls through to 'mutate' rather than
    // 'reveal' (the same reveal-collapse-to-mutate behavior probed in pickers.test.ts row 17).
    const childLabels = (opener.children ?? []).map((c) => c.label);
    expect(childLabels).not.toContain('United States');
    expect(opener.kind).toBe('mutate');
  });

  it('MATRIX-MISMATCH probe: because enumeratedNames already runs on diff.added regardless of role, the reveal-children half is NOT polluted — only the SEPARATE recorded click (clickValue) leaks', () => {
    // this narrows the matrix's row-26 claim: attribution during the OPENING click is fine
    // (enumeratedNames is role-agnostic, unlike insideOverlay's role-keyed gate). The actual
    // pollution vector is specifically a LATER recorded action whose fromSnapshot has the value
    // already open — clickedInOverlay's insideOverlay ancestor-role check is what's missing.
    const g = draftFromEffects([enter, openPopover, clickValue] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    const opener = s.affordances.find((a) => a.label === 'Publisher')!;
    expect((opener.children ?? []).some((c) => c.label === 'United States')).toBe(false);
    // yet the SAME name shows up as a stand-alone page affordance from the separate clickValue effect.
    expect(s.affordances.some((a) => a.label === 'United States' && a.kind !== 'reveal')).toBe(true);
  });
});

// ── gx-canvas (row 79 — GAP, out of scope by design) ────────────────────────────────────────
// role=application with a near-EMPTY tree (all state lives in pixels/WebGL). Nothing declared ⇒
// nothing to map — the posture is DETECT + ESCALATE, map the chrome around it. Asserts: the
// application zone itself contributes no affordances, while the surrounding chrome (a Save/Export
// toolbar) still maps normally.
describe('grammar: 79 canvas / role=application interior — GAP, out of scope (posture: map the chrome, nothing from the canvas)', () => {
  const PAGE = [
    '- heading "Design Canvas" [ref=e1]',
    '- button "Save" [ref=e2]',
    '- button "Export" [ref=e3]',
    '- application [ref=e4]',   // near-empty: no name, no children captured (canvas/WebGL interior)
    '- paragraph "Untitled design" [ref=e5]',
    '- paragraph "Autosaved" [ref=e6]',
    '- paragraph "Team project" [ref=e7]',
    '- paragraph "Last edited" [ref=e8]',
  ].join('\n');
  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/canvas/9`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } as any };
  const g = draftFromEffects([enter] as never);
  const s = g.states.find((x) => x.label === 'canvas')!;

  it('the application zone contributes NO affordance (nothing declared, nothing mapped)', () => {
    expect(s.affordances.some((a) => a.elementFp?.role === 'application')).toBe(false);
  });

  it('the surrounding chrome (Save/Export) maps normally around the a11y-hostile interior', () => {
    expect(s.affordances.some((a) => a.label === 'Save' && a.kind === 'mutate' && a.needsClassification)).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Export' && a.kind === 'mutate')).toBe(true);
  });
});
