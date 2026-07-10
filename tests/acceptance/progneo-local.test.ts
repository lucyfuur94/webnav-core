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

    // report page: page-level (non-row) affordances bounded — no ~130-affordance data explosion
    const report = g.states.find((s) => s.label === 'report')!;
    expect(report, 'report state').toBeDefined();
    expect(report.affordances.filter((a) => !a.scope).length).toBeLessThanOrEqual(30);

    // no fingerprint anchored on instance data (the logged-in user's name)
    expect(g.states.every((s) => !s.fingerprint.join().includes('Testuser'))).toBe(true);

    // single-landing pages reported as provisional record-next asks
    expect(g.receipt.requests.length).toBeGreaterThan(0);
  });
});
