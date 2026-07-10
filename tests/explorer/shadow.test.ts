import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { extractShadow } from '../../src/explorer/shadow.js';

const fixture = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures', name), 'utf8');

// Layer 2: extract the DECLARED domain shadow (evidence, never interpretation #5a) from a page
// snapshot — collections (table heading + columns), real-ARIA filter controls, and the
// Add-button's owning entity heading. Grounded in the frozen real OrangeHRM PIM snapshot
// (tests/fixtures/orangehrm-pim-table.yml). A record COUNT is data, not structure (rule 2,
// 2026-07-10) — never extracted. subTabs/subTabContainer removed (site-specific container names).
describe('extractShadow — declared domain shadow (Layer 2)', () => {
  const pim = parseSnapshot(fixture('orangehrm-pim-table.yml'));
  const shadow = extractShadow(pim);

  it('captures the collection: table heading + column headers (verbatim, NO record count)', () => {
    expect(shadow.collections?.length).toBeGreaterThanOrEqual(1);
    const c = shadow.collections![0];
    // columns are the columnheader nodes' names, verbatim. The empty select-all checkbox
    // columnheader ("") is dropped (no semantic value).
    expect(c.columns).toEqual(['Id', 'First (& Middle) Name', 'Last Name', 'Job Title', 'Employment Status', 'Sub Unit', 'Supervisor', 'Actions']);
    expect(c.recordCount ?? null).toBeNull();         // rule 2: a count is DATA — never populated
    expect(c.heading).toBe('Employee Information');   // nearest enclosing heading
  });

  it('captures real-ARIA filter controls only (textbox/combobox), NOT div-soup pseudo-selects', () => {
    // OrangeHRM's "Employee Name" / "Supervisor Name" are real textboxes; the Job Title / Sub Unit
    // "selects" are generic divs (NOT combobox role) — those are NOT inferred (would be layout-guessing).
    const fields = (shadow.filters ?? []).map((f) => f.field);
    // the real textboxes are captured (by their accessible name)
    expect(fields.some((f) => f.includes('Type for hints') || f === 'Search')).toBe(true);
    // a generic-div pseudo-select must NOT appear as a filter (no inference)
    expect(fields).not.toContain('Job Title');
    expect(fields).not.toContain('Sub Unit');
  });

  it('captures createsEntity = the Add button\'s nearest enclosing heading', () => {
    expect(shadow.createsEntity).toBe('Employee Information');
  });

  it('every captured string is verbatim from the snapshot — only icon-glyphs/whitespace stripped', () => {
    const all = [
      ...(shadow.collections ?? []).flatMap((c) => [c.heading, ...c.columns]),
      ...(shadow.filters ?? []).map((f) => f.field),
      shadow.createsEntity,
    ].filter(Boolean) as string[];
    // strip Private-Use-Area glyphs + collapse whitespace from the raw too (the only transform
    // extractShadow applies); every captured value must then appear literally in that cleaned raw.
    const cleanedRaw = fixture('orangehrm-pim-table.yml')
      .replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').replace(/[ \t]+/g, ' ');
    for (const s of all) expect(cleanedRaw).toContain(s);
  });

  it('a snapshot with no table/filters/add → empty shadow (no fabrication)', () => {
    const bare = parseSnapshot('- heading "Welcome" [ref=e1]\n- paragraph [ref=e2]: hello');
    const s = extractShadow(bare);
    expect(s.collections ?? []).toEqual([]);
    expect(s.filters ?? []).toEqual([]);
    expect(s.createsEntity ?? null).toBeNull();
  });

  it('rule 2: a record COUNT is DATA — never extracted even when the page declares one', () => {
    // "(47) Records Found" is a data value (it changes with the rows), not structure. The shadow
    // records the table's SHAPE (heading + columns), never its size.
    const withCount = parseSnapshot('- table [ref=e1]:\n  - columnheader "Name" [ref=e2]\n- generic [ref=e3]: (47) Records Found');
    const c = extractShadow(withCount).collections![0];
    expect(c.columns).toEqual(['Name']);
    expect(c.recordCount ?? null).toBeNull();          // populated by nothing
  });

  it('rule 2: a filter control INSIDE an overlay is skipped (an enumerated value list is data)', () => {
    // a real-ARIA textbox that lives under a dialog/listbox is the overlay's own control (a search
    // box for a value picker), not the page's declared filter surface — insideOverlay gates it out.
    const snap = parseSnapshot([
      '- textbox "Employee Name" [ref=e1]',            // page-level filter → kept
      '- dialog "Pick a dimension" [ref=e2]:',
      '  - textbox "Search options" [ref=e3]',         // overlay control → skipped
      '  - checkbox "Region" [ref=e4]',                // enumerated value in the overlay → skipped
    ].join('\n'));
    const fields = (extractShadow(snap).filters ?? []).map((f) => f.field);
    expect(fields).toContain('Employee Name');
    expect(fields).not.toContain('Search options');
    expect(fields).not.toContain('Region');
  });
});
