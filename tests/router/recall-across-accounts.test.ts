import { describe, it, expect } from 'vitest';
import { matchState } from '../../src/explorer/fingerprint.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { makeState } from '../../src/mapstore/types.js';

// #3a — a map recorded on one account path (.../v3/9999/report/list) must still be
// RECALLABLE when the user browses the same page under a DIFFERENT account id
// (.../v3/9999/report/list). Volatile numeric/opaque id path segments are NOT page
// identity; the structural fingerprint IS. These tests pin that the recall path keys
// on the fingerprint, so a differing account/id segment never causes a "no map" miss —
// while a genuinely different PAGE still misses. Realistic (report-shaped) urls, but
// the assertions are the GENERAL rule (no site-specific string is asserted on).

// A state recorded on account 1041. urlPattern is a concrete instance URL (an attribute),
// the fingerprint is the durable identity.
const reportList = makeState({
  id: 'site:report-list', nodeId: 'site', semanticName: 'report-list', role: 'detail',
  urlPattern: 'https://site.example/v3/9999/report/list',
  fingerprint: ['heading:Reports'],
});
const dashboardList = makeState({
  id: 'site:dashboard-list', nodeId: 'site', semanticName: 'dashboard-list', role: 'detail',
  urlPattern: 'https://site.example/v3/9999/dashboard/list',
  fingerprint: ['heading:Dashboards'],
});
const reportDraftTable = makeState({
  id: 'site:report-draft-table', nodeId: 'site', semanticName: 'report-draft-table', role: 'detail',
  // recorded on an opaque hex report-draft id
  urlPattern: 'https://site.example/v3/9999/report/draft/71336cdec7f7af8948dfb95faf37ad26',
  fingerprint: ['tab:Table'],
});
const states = [reportList, dashboardList, reportDraftTable];

// The report-list page renders `heading "Reports"` regardless of which account is in the URL.
const reportListPage = 'heading "Reports" [level=1]\n';
// A different page (dashboards) renders a different heading.
const dashboardListPage = 'heading "Dashboards" [level=1]\n';
// The report-draft table view, on a DIFFERENT opaque hex than was recorded.
const reportDraftTablePage = 'tab "Table" [ref=e1]\n';

describe('recall across account ids (#3a — fingerprint identity, url is an attribute)', () => {
  it('matches the same page under a DIFFERENT account id (1041-recorded -> 1033 live)', () => {
    // The live url is /v3/9999/report/list — a different account segment than the
    // recorded /v3/9999/... — but the page structure is identical, so recall must match.
    const m = matchState(parseSnapshot(reportListPage), states);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') expect(m.state.id).toBe('site:report-list');
  });

  it('does NOT match a DIFFERENT page under the same account id (report-list vs dashboard-list)', () => {
    const m = matchState(parseSnapshot(dashboardListPage), states);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') expect(m.state.id).toBe('site:dashboard-list');
  });

  it('matches an opaque-hex instance page on a DIFFERENT hex than recorded', () => {
    // recorded on hex 71336cd..., a live visit to /report/draft/<other-hex>/... still
    // renders the same `tab:Table` structure -> same state.
    const m = matchState(parseSnapshot(reportDraftTablePage), states);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') expect(m.state.id).toBe('site:report-draft-table');
  });
});
