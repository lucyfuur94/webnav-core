import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractRepoSignals } from '../../src/router/extract.js';

const yml = readFileSync('tests/fixtures/github-repo-detail.yml', 'utf8');
const ALL = ['stars','forks','open_issues','open_prs','commits','tags','last_commit','license'];

describe('extractRepoSignals (rich, real GitHub shapes)', () => {
  it('extracts the exact star integer from "N users starred this repository"', () => {
    expect(extractRepoSignals(yml, ['stars']).stars).toBe(8621);
  });
  it('extracts forks, issues, prs, commits, tags as integers', () => {
    const s = extractRepoSignals(yml, ALL);
    expect(s.forks).toBe(322);
    expect(s.open_issues).toBe(18);
    expect(s.open_prs).toBe(16);
    expect(s.commits).toBe(586);
    expect(s.tags).toBe(74);
  });
  it('extracts the last commit date', () => {
    expect(extractRepoSignals(yml, ['last_commit']).last_commit).toBe('May 22, 2026');
  });
  it('extracts the license name', () => {
    expect(String(extractRepoSignals(yml, ['license']).license)).toMatch(/MIT/);
  });
  it('only extracts requested signals', () => {
    const s = extractRepoSignals(yml, ['stars']);
    expect(s).not.toHaveProperty('forks');
    expect(s).not.toHaveProperty('open_issues');
  });
  it('omits a signal whose pattern is absent (never fabricates)', () => {
    const s = extractRepoSignals('- heading "x" [ref=e1]', ALL);
    expect(s).not.toHaveProperty('stars');
    expect(s).not.toHaveProperty('last_commit');
  });

  // Regression (found via live run): the file-tree row "LICENSE, (File)" also
  // contains "license" but is a FILE, not the repo's license. Must be rejected;
  // the real license name ("AGPL-3.0 license") must be picked instead.
  it('rejects file-tree LICENSE rows and extracts the real license name', () => {
    const yml = [
      '- link "LICENSE, (File)" [ref=e1]:',
      '    - /url: /o/r/blob/main/LICENSE',
      '- link "AGPL-3.0 license" [ref=e2]:',
      '    - /url: /o/r/blob/main/LICENSE',
    ].join('\n');
    expect(extractRepoSignals(yml, ['license']).license).toBe('AGPL-3.0 license');
  });

  it('omits license when only a file-tree LICENSE row is present (no real name)', () => {
    const yml = '- link "LICENSE, (File)" [ref=e1]:\n    - /url: /o/r/blob/main/LICENSE';
    expect(extractRepoSignals(yml, ['license'])).not.toHaveProperty('license');
  });
});
