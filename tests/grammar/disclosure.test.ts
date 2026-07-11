// Grammar suite — DISCLOSURE & VIEW SWITCHING group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const B = 'https://tabs.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://tabs.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

// ── fx-tabs-both (rows 41 Tabs, 4 Toggle group/segmented control) ──────────────────────────
// A URL-synced tablist (switching a tab CHANGES the URL — an addressable sub-state) beside a
// client-only tablist (switching stays on the same URL, just reveals a different panel) plus a
// segmented control (pressed-button style). Asserts: navigate-vs-reveal decided purely by the
// OBSERVED effect (URL change or not), never by role alone, and that an unmounted/inactive panel
// is a dangling stub until explored.
describe('grammar: 41/4 tabs (URL-synced vs client-only) + segmented control — navigate-vs-reveal by effect', () => {
  // ── URL-synced tablist: activating a tab NAVIGATES (?tab= changes) ──
  const REPORT_TABLE = ['- heading "Report" [ref=e1]', '- tab "Table" [ref=e2]', '- tab "Charts" [ref=e3]',
    '- tabpanel [ref=e4]:', '  - listitem "Row A" [ref=e5]',
    '- button "Export" [ref=e6]', '- paragraph "Report view" [ref=e7]', '- paragraph "Draft" [ref=e8]'].join('\n');
  const REPORT_CHARTS = ['- heading "Report" [ref=e1]', '- tab "Table" [ref=e2]', '- tab "Charts" [ref=e3]',
    '- tabpanel [ref=e4]:', '  - img "Revenue chart" [ref=e5]',
    '- button "Export" [ref=e6]', '- paragraph "Report view" [ref=e7]', '- paragraph "Draft" [ref=e8]'].join('\n');
  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/report/9?tab=table`, toSnapshot: REPORT_TABLE, navigated: true, diff: { added: [], removed: [] } as any };
  const switchToCharts: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/report/9?tab=table`, fromSnapshot: REPORT_TABLE,
    action: { role: 'tab', name: 'Charts', ref: 'e3', elementFp: { role: 'tab', name: 'Charts', near: null } },
    toUrl: `${B}/report/9?tab=charts`, toSnapshot: REPORT_CHARTS, navigated: true, diff: { added: [], removed: [] } as any };

  it('a URL-synced tab switch is a NAVIGATE (the ?tab= query changed)', () => {
    const g = draftFromEffects([enter, switchToCharts] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    const tabAff = s.affordances.find((a) => a.label === 'Charts')!;
    expect(tabAff).toBeTruthy();
    expect(tabAff.kind).toBe('navigate');
  });

  // ── client-only tablist: activating a tab stays on the SAME URL, reveals a different panel ──
  const SETTINGS_GENERAL = ['- heading "Settings" [ref=e1]', '- tab "General" [ref=e2]', '- tab "Security" [ref=e3]',
    '- textbox "Display name" [ref=e4]', '- button "Save" [ref=e5]',
    '- paragraph "Preferences" [ref=e6]', '- paragraph "Account" [ref=e7]', '- paragraph "General settings" [ref=e8]'].join('\n');
  const SECURITY_ADDED = ['- textbox "Two-factor code" [ref=e9]', '- button "Enable 2FA" [ref=e10]'];
  const SETTINGS_SECURITY = [SETTINGS_GENERAL, ...SECURITY_ADDED].join('\n');
  const settingsEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/cfg/settings`, toSnapshot: SETTINGS_GENERAL, navigated: true, diff: { added: [], removed: [] } as any };
  const switchToSecurity: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/cfg/settings`, fromSnapshot: SETTINGS_GENERAL,
    action: { role: 'tab', name: 'Security', ref: 'e3', elementFp: { role: 'tab', name: 'Security', near: null } },
    toUrl: `${B}/cfg/settings`, toSnapshot: SETTINGS_SECURITY, navigated: false,
    diff: { added: parseSnapshot(SECURITY_ADDED.join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };

  it('a client-only tab switch (same URL) that reveals new nodes classifies as REVEAL, not navigate', () => {
    const g = draftFromEffects([settingsEnter, switchToSecurity] as never);
    const s = g.states.find((x) => x.label === 'cfg-settings')!;
    const tabAff = s.affordances.find((a) => a.label === 'Security')!;
    expect(tabAff).toBeTruthy();
    expect(tabAff.kind).toBe('reveal');
    expect((tabAff.children ?? []).some((c) => c.label === 'Enable 2FA')).toBe(true);
  });

  it('an inactive/unmounted tab panel that was never explored produces no dangling page (honest — nothing recorded, nothing invented)', () => {
    // the design's "dangling until explored" claim means: without a recorded switch, webnav does
    // not invent a stub state for the unswitched tab. Only ONE settings state exists.
    const g = draftFromEffects([settingsEnter] as never);
    const labels = g.states.map((x) => x.label);
    expect(labels.filter((l) => l === 'cfg-settings').length).toBe(1);
  });

  // ── segmented control (toggle group): 3 pressed-style buttons, same-page mutate ──
  const LIST_ALL = ['- heading "Tasks" [ref=e1]', '- button "All" [ref=e2] [aria-pressed=true]',
    '- button "Active" [ref=e3] [aria-pressed=false]', '- button "Done" [ref=e4] [aria-pressed=false]',
    '- listitem "Task 1" [ref=e5]', '- paragraph "Task list" [ref=e6]',
    '- paragraph "3 tasks" [ref=e7]', '- paragraph "Board" [ref=e8]'].join('\n');
  const segEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/task/board`, toSnapshot: LIST_ALL, navigated: true, diff: { added: [], removed: [] } as any };

  it('a segmented-control button (aria-pressed) synthesizes as a mutate affordance (same-page toggle)', () => {
    const g = draftFromEffects([segEnter] as never);
    const s = g.states.find((x) => x.label === 'task-board')!;
    expect(s.affordances.some((a) => a.label === 'Active' && a.kind === 'mutate')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Done' && a.kind === 'mutate')).toBe(true);
  });
});
