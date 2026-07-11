import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — mapping verbs (under dev)', () => {
  it('parses record-start with --session', () => {
    expect(parseArgs(['dev', 'record-start', '--session', 's1'])).toEqual({ cmd: 'record-start', session: 's1' });
  });
  it('parses record-stop', () => {
    expect(parseArgs(['dev', 'record-stop', '--session', 's1'])).toEqual({ cmd: 'record-stop', session: 's1' });
  });
  it('parses graph-analyse (single session → sessions array)', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1'])).toEqual({ cmd: 'graph-analyse', sessions: ['s1'], host: undefined, draft: false, skipReviewGate: false });
  });
  it('parses graph-analyse --draft', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1', '--draft'])).toEqual({ cmd: 'graph-analyse', sessions: ['s1'], host: undefined, draft: true, skipReviewGate: false });
  });
  it('parses graph-analyse with MULTIPLE --session flags (merge)', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1', '--session', 's2', '--draft'])).toEqual({ cmd: 'graph-analyse', sessions: ['s1', 's2'], host: undefined, draft: true, skipReviewGate: false });
  });
  it('parses graph-analyse --host (all sessions for a site)', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--host', 'x.test', '--draft'])).toEqual({ cmd: 'graph-analyse', sessions: [], host: 'x.test', draft: true, skipReviewGate: false });
  });
  it('parses graph-analyse --skip-review-gate', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1', '--draft', '--skip-review-gate'])).toEqual({ cmd: 'graph-analyse', sessions: ['s1'], host: undefined, draft: true, skipReviewGate: true });
  });
  it('parses graph-edit with node + graph json', () => {
    expect(parseArgs(['dev', 'graph-edit', '--node', 'example.com', '--graph', '{"states":[],"edges":[]}']))
      .toEqual({ cmd: 'graph-edit', node: 'example.com', graph: '{"states":[],"edges":[]}' });
  });
  it('parses graph-show', () => {
    expect(parseArgs(['dev', 'graph-show', '--node', 'example.com'])).toEqual({ cmd: 'graph-show', node: 'example.com' });
  });
  it('parses node-clear', () => {
    expect(parseArgs(['dev', 'node-clear', '--node', 'example.com'])).toEqual({ cmd: 'node-clear', node: 'example.com' });
  });
  it('parses node-rm', () => {
    expect(parseArgs(['dev', 'node-rm', '--node', 'example.com'])).toEqual({ cmd: 'node-rm', node: 'example.com' });
  });
  it('parses import-map with a file', () => {
    expect(parseArgs(['dev', 'import-map', 'packs/saucedemo.json'])).toEqual({ cmd: 'import-map', file: 'packs/saucedemo.json' });
  });
  it('parses import-map with --file', () => {
    expect(parseArgs(['dev', 'import-map', '--file', 'packs/x.json'])).toEqual({ cmd: 'import-map', file: 'packs/x.json' });
  });
  it('parses dev sessions list (default sub)', () => {
    expect(parseArgs(['dev', 'sessions'])).toEqual({ cmd: 'sessions', sub: 'list', all: false, maxAgeHours: undefined });
  });
  it('parses dev sessions reap --all', () => {
    expect(parseArgs(['dev', 'sessions', 'reap', '--all'])).toEqual({ cmd: 'sessions', sub: 'reap', all: true, maxAgeHours: undefined });
  });
  it('parses dev sessions reap --max-age-hours', () => {
    expect(parseArgs(['dev', 'sessions', 'reap', '--max-age-hours', '4'])).toEqual({ cmd: 'sessions', sub: 'reap', all: false, maxAgeHours: 4 });
  });
  it('parses profile-status with --profile and --site', () => {
    expect(parseArgs(['dev', 'profile-status', '--profile', 'work', '--site', 'www.saucedemo.com']))
      .toEqual({ cmd: 'profile-status', profile: 'work', site: 'www.saucedemo.com', url: undefined });
  });
  it('parses profile-status with --url override', () => {
    expect(parseArgs(['dev', 'profile-status', '--profile', 'work', '--site', 'progneo.analytics.mn', '--url', 'https://progneo.analytics.mn/dashboard']))
      .toEqual({ cmd: 'profile-status', profile: 'work', site: 'progneo.analytics.mn', url: 'https://progneo.analytics.mn/dashboard' });
  });
  it('parses profile-status with missing flags as empty strings', () => {
    expect(parseArgs(['dev', 'profile-status'])).toEqual({ cmd: 'profile-status', profile: '', site: '', url: undefined });
  });
});
