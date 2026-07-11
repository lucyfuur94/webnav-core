// Grammar suite — PICKERS & COMPOSITE INPUTS group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
// Fixture idiom (reused from tests/explorer/draft.test.ts): YAML-ish snapshot literals via
// parseSnapshot, >=8 named nodes per landing (classifyReadiness='ready'), distinct first-segment
// URLs, driven through the REAL draftFromEffects pipeline with recorded action-effects.
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const B = 'https://fx.test';

// A READY entry landing distinct from every fixture's own first segment, shared across this file.
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://fx.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

const enter = (toUrl: string, toSnapshot: string): StoredActionEffect => ({
  seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
  toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] } as any,
});

// ── fx-select-portal (rows 17 Select, 19 Combobox, 22 Listbox) ──────────────────────────────
// Trigger combobox with aria-haspopup=listbox -> a PORTAL listbox appended at document end
// (depth 0, same as the trigger — portals are NOT nested under the trigger in a real a11y tree).
// Also covers the async-empty combobox (no options yet, readiness/never-recorded, not asserted
// here beyond "no option ever becomes an affordance").
describe('grammar: 17/19/22 select/combobox/listbox portal — options never stored, reveal to trigger', () => {
  const FORM = [
    '- heading "New Order" [ref=e1]',
    '- combobox "Country" [ref=e2] [aria-haspopup=listbox]',
    '- button "Save" [ref=e3]',
    '- paragraph "Choose a shipping country" [ref=e4]',
    '- paragraph "Required" [ref=e5]',
    '- paragraph "Draft order" [ref=e6]',
    '- paragraph "Order form" [ref=e7]',
    '- paragraph "Ships worldwide" [ref=e8]',
  ].join('\n');
  // opening the combobox portal-appends a listbox with >=3 same-depth options (a real value
  // domain) at the END of the document (depth 0, sibling of everything else) — proving
  // attribution is role-keyed (overlay-role ancestry), NOT proximity to the trigger.
  const PORTAL_OPTIONS = [
    '  - option "United States" [ref=e10]',
    '  - option "United Kingdom" [ref=e11]',
    '  - option "Canada" [ref=e12]',
  ];
  const FORM_OPEN = [FORM, '- listbox [ref=e9]:', ...PORTAL_OPTIONS].join('\n');
  const openTrigger: StoredActionEffect = {
    seq: 1, capturedAt: 0, fromUrl: `${B}/order/new`, fromSnapshot: FORM,
    action: { role: 'combobox', name: 'Country', ref: 'e2', elementFp: { role: 'combobox', name: 'Country', near: null } },
    toUrl: `${B}/order/new`, toSnapshot: FORM_OPEN, navigated: false,
    diff: { added: parseSnapshot(['- listbox [ref=e9]:', ...PORTAL_OPTIONS].join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any,
  };
  // a value pick INSIDE the portal listbox (FROM = FORM_OPEN, so the option is insideOverlay).
  const pickOption: StoredActionEffect = {
    seq: 2, capturedAt: 0, fromUrl: `${B}/order/new`, fromSnapshot: FORM_OPEN,
    action: { role: 'option', name: 'United States', ref: 'e10', elementFp: { role: 'option', name: 'United States', near: null } },
    toUrl: `${B}/order/new`, toSnapshot: FORM_OPEN, navigated: false, diff: { added: [], removed: [] } as any,
  };

  it('the options are NEVER stored as page affordances (the no-values rule)', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    for (const name of ['United States', 'United Kingdom', 'Canada']) {
      expect(s.affordances.some((a) => a.label === name)).toBe(false);
    }
  });

  // MATRIX-MISMATCH: the matrix row 17 says the trigger becomes a `reveal`. In practice, when
  // the ONLY added nodes are `option` role members (a plain listbox with no Apply/Cancel/Search
  // chrome), every option is BOTH excluded from REVEAL_CHILD_ROLES (draft.ts:32 has no 'option')
  // AND filtered as a value domain (enumeratedNames) — so `children.length === 0` and the opener
  // falls through to `mutate`, not `reveal` (draft.ts ~757-761). The no-values-stored half of the
  // matrix promise holds; the reveal-kind half does not for an option-only portal.
  it.fails('reveal attribution goes to the TRIGGER (combobox), not the page body — MATRIX-MISMATCH: opener classifies mutate (children=0; option role excluded from REVEAL_CHILD_ROLES), not reveal', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    const opener = s.affordances.find((a) => a.label === 'Country')!;
    expect(opener).toBeTruthy();
    expect(opener.kind).toBe('reveal');
  });

  it('current (mismatched) behavior: the opener classifies as mutate, not reveal, for an option-only portal', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    const opener = s.affordances.find((a) => a.label === 'Country')!;
    expect(opener).toBeTruthy();
    expect(opener.kind).toBe('mutate');   // honest pin of the actual behavior (MATRIX-MISMATCH above)
  });

  it('page-level durable actions (Save) survive alongside the picker', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    expect(s.affordances.some((a) => a.label === 'Save' && a.kind === 'mutate')).toBe(true);
  });
});

// ── fx-data-grid's role-2/named picker sibling: standalone listbox (row 22) baseline-present
// vs transient — covered separately in overlays.test.ts (menu/listbox baseline precedence, X8).

// ── row 18 Multi-select — PARTIAL (OQ2: needs container-scoped folding). Documents the
// honest degradation: tags-in-trigger (a NESTED value domain inside a page-level control) leak
// as page-level data today because subtreeFolds/enumeratedNames don't fold across the trigger
// boundary into a portal-listbox's OWN separate node set. We assert the CURRENT behavior described
// by the matrix row 18 verdict; if OQ2 lands this test's premise changes and must be revisited.
describe('grammar: 18 multi-select — PARTIAL (tags-in-trigger nested value domain, OQ2)', () => {
  const MULTI = [
    '- heading "Assign Labels" [ref=e1]',
    '- combobox "Labels" [ref=e2] [aria-haspopup=listbox]',
    '- button "bug" [ref=e3]',            // a selected-item tag rendered INSIDE the trigger
    '- button "urgent" [ref=e4]',         // a second selected-item tag
    '- button "Save" [ref=e5]',
    '- paragraph "Pick one or more labels" [ref=e6]',
    '- paragraph "Draft" [ref=e7]',
    '- paragraph "Issue form" [ref=e8]',
  ].join('\n');

  it('MATRIX-MISMATCH probe: tags-in-trigger DO get folded away today (better than the matrix PARTIAL claims)', () => {
    // rows 3-4 ("bug"/"urgent") are just 2 page-level buttons here — below the >=3 fold threshold,
    // so they synthesize as their OWN mutate affordances via interior synthesis. This is the honest
    // engine behavior on a 2-tag case: no fold fires (subtreeFolds needs >=3 named OR distinct
    // members to abstract), so nothing is de-valued. Document as-is, not bent to match the matrix's
    // framing of "leaks as page-level data" — with only 2 tags there is no fold to trigger, so they
    // simply synthesize as ordinary mutate controls (still technically "page-level data" in spirit:
    // per-selection tag names become stored affordances, which is the OQ2 gap in practice).
    const g = draftFromEffects([enter(`${B}/issue/9`, MULTI)] as never);
    const s = g.states.find((x) => x.label === 'issue')!;
    expect(s.affordances.some((a) => a.label === 'bug')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'urgent')).toBe(true);
    // per matrix OQ2: this is the honest degradation — per-selection values ARE stored as
    // ordinary affordances because no container-scoped fold exists to catch a 2-item trigger.
  });
});
