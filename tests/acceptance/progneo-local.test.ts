import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RecordStore } from '../../src/mapstore/record.js';
import { draftFromEffects } from '../../src/explorer/draft.js';

// OFFLINE ACCEPTANCE against the REAL progneo recording data (5 review-approved sessions, 185
// effects) living in ~/.webnav/webnav.db. Env-gated: runs on the dev machine, skips in CI.
// The assertions ARE the design's acceptance bar (2026-07-10-structure-inference-design.md §
// "Acceptance"). A failure is a FINDING to fix in the producing stage (draft/infer/shadow),
// never an assertion to relax. Read-only usage of the store (actionEffects per session).
const DB = join(homedir(), '.webnav/webnav.db');
// order the sessions the way a forward walk-through would visit them (list → nav → build → downloads → viewer).
const SESSIONS = ['reports-list', 'sidebar-nav', 'report-builder', 'dashboard-download-lists', 'dashboard-viewer'];

describe.skipIf(!existsSync(DB))('progneo offline acceptance', () => {
  it('the real 5-session map is clean (no ghosts, no data-values, shell extracted, provisional reported)', () => {
    const store = new RecordStore(DB);
    const effects = SESSIONS.flatMap((s) => store.actionEffects(s));
    const g = draftFromEffects(effects);

    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('report-list');
    expect(labels.join(',')).not.toMatch(/-2\b/); // no ghost numeric suffix (report-list-2)

    // no data-values anywhere in states or their overlay children
    const all = g.states.flatMap((s) => s.affordances.flatMap((a) => [a, ...(a.children ?? [])]));
    for (const bad of ['Publisher', 'United States', 'Country'])
      expect(all.some((a) => a.label === bad), bad).toBe(false);
    expect(all.some((a) => /^\d{2} \w{3} \d{4}$/.test(a.label))).toBe(false); // no date literals (02 Jul 2026)

    // shell extracted once, sidebar + topbar
    const shell = g.states.find((s) => s.label === '_shell')!;
    expect(shell, '_shell state').toBeDefined();
    expect(shell.affordances.length).toBeGreaterThanOrEqual(8);

    // The BUILDER state — picked by urlPattern (the report-builder session's entry page), not by
    // label (viz-variant merging/naming may move the label). Bounded on BOTH sides: the upper
    // bound kills the ~130-affordance data explosion; the LOWER bounds kill the hollow-pass husk
    // (Task 15 review finding: 46 genuine recorded builder actions were dropped by the
    // i===0-only entry-landing rule + the missing canonical-key attribution, and 3 affordances
    // sailed under `≤30`).
    const builder = g.states.find((s) => s.urlPattern.includes('/report/16116/bd5a'))!;
    expect(builder, 'builder state (bd5a urlPattern)').toBeDefined();
    const builderPageLevel = builder.affordances.filter((a) => !a.scope);
    expect(builderPageLevel.length).toBeGreaterThanOrEqual(8);
    expect(builderPageLevel.length).toBeLessThanOrEqual(30);
    // ground-truth recorded builder actions must be present (as affordance or reveal label)
    const builderNames = new Set(builder.affordances.flatMap((a) => [a.label, ...(a.children ?? []).map((c) => c.label)]));
    const groundTruth = ['Share', 'Save As / Schedule', 'Add dimensions', 'Add metrics', 'Download as formatted CSV', 'Save Visualization'];
    expect(groundTruth.filter((n) => builderNames.has(n)).length).toBeGreaterThanOrEqual(4);

    // KIND regression lock (the reveal-by-behavior shape-guard class shipped 2026-07-11 because
    // acceptance asserted presence/counts only): a filter-tab click that RE-RENDERS the grid and a
    // click-shows-tooltip are MUTATE; genuine overlay openers are REVEAL. Presence alone let a
    // mutate→reveal drift sail through — pin the kinds of known recorded actions.
    const kindsByLabel = new Map<string, string>();
    for (const s of g.states) for (const a of s.affordances) if (!kindsByLabel.has(a.label)) kindsByLabel.set(a.label, a.kind);
    expect(kindsByLabel.get('Owned/Shared'), 'Owned/Shared (grid re-render)').toBe('mutate');
    expect(kindsByLabel.get('Standard'), 'Standard (grid re-render)').toBe('mutate');
    expect(kindsByLabel.get('Save As / Schedule'), 'Save As / Schedule (menu opener)').toBe('reveal');
    expect(kindsByLabel.get('Add dimensions'), 'Add dimensions (dialog opener)').toBe('reveal');

    // no fingerprint anchored on instance data (the logged-in user's name)
    expect(g.states.every((s) => !s.fingerprint.join().includes('Testuser'))).toBe(true);

    // single-landing pages reported as provisional record-next asks
    expect(g.receipt.requests.length).toBeGreaterThan(0);
  });

  // ── Task 3 (subtree-templates): identity-face normalization + subtree-fold acceptance across
  // the real ae / ohrm / progneo recordings (all in this DB). Normalization (dispose + SPA-split
  // predicates only) folds a page's repeated widget/row subtrees to a `widget:<sig>` presence
  // token so two instances of one template read as one face. These assertions pin the invariants
  // that hold on the real data; a failure is a producing-stage finding, never a relaxation.
  it('Task 3: report intact, Expand-drilldown folded once, ae one product-details, ohrm columns kept', () => {
    const store = new RecordStore(DB);

    // ── progneo: report unchanged (12/12 ground truth is over the two report views; page-level
    // ≤30) and the ×25 'Expand drilldown' row folds to AT MOST ONE affordance/child anywhere. ──
    const prog = draftFromEffects(SESSIONS.flatMap((s) => store.actionEffects(s)));
    const builder = prog.states.find((s) => s.urlPattern.includes('/report/16116/bd5a'))!;
    const builderPageLevel = builder.affordances.filter((a) => !a.scope);
    expect(builderPageLevel.length).toBeLessThanOrEqual(30);
    const builderNames = new Set(builder.affordances.flatMap((a) => [a.label, ...(a.children ?? []).map((c) => c.label)]));
    const groundTruth = ['Share', 'Save As / Schedule', 'Add dimensions', 'Add metrics', 'Download as formatted CSV', 'Save Visualization'];
    expect(groundTruth.filter((n) => builderNames.has(n)).length).toBeGreaterThanOrEqual(4);
    let expandDrilldown = 0;
    for (const s of prog.states) for (const a of s.affordances) {
      if (a.label === 'Expand drilldown') expandDrilldown++;
      for (const c of a.children ?? []) if (c.label === 'Expand drilldown') expandDrilldown++;
    }
    expect(expandDrilldown, "'Expand drilldown' folds to at most one").toBeLessThanOrEqual(1);
    // no fingerprint anchors on the logged-in user's name (instance data — #5).
    expect(prog.states.every((s) => !s.fingerprint.join().includes('Testuser'))).toBe(true);

    // ── ae: /product_details/1 + /product_details/3 merge to EXACTLY ONE product-details (the
    // control-arm merge; normalization leaves it untouched — controls are shared, not folded). ──
    const ae = draftFromEffects(store.actionEffects('ae-validate'));
    const productDetails = ae.states.filter((s) => /product_details/.test(s.urlPattern) || s.label.includes('product-details'));
    expect(productDetails.length, 'ae: exactly one product-details').toBe(1);

    // ── ohrm: the PIM grid's declared columns survive in the shadow (the row-fold of the grid
    // rows does not strip the columnheader structure). ──
    const ohrm = draftFromEffects(store.actionEffects('ohrm-validate'));
    const pim = ohrm.states.find((s) => /pim/.test(s.label))!;
    const cols = pim.declaredShadow?.collections?.[0]?.columns ?? [];
    expect(cols).toContain('Job Title');
    expect(cols.length).toBeGreaterThanOrEqual(5);
  });
});
