import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — mapping verbs (under dev)', () => {
  it('parses record-start with --session', () => {
    expect(parseArgs(['dev', 'record-start', '--session', 's1'])).toEqual({ cmd: 'record-start', session: 's1' });
  });
  it('parses record-stop', () => {
    expect(parseArgs(['dev', 'record-stop', '--session', 's1'])).toEqual({ cmd: 'record-stop', session: 's1' });
  });
  it('parses graph-analyse', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1'])).toEqual({ cmd: 'graph-analyse', session: 's1', draft: false });
  });
  it('parses graph-analyse --draft', () => {
    expect(parseArgs(['dev', 'graph-analyse', '--session', 's1', '--draft'])).toEqual({ cmd: 'graph-analyse', session: 's1', draft: true });
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
  it('parses dev sessions list (default sub)', () => {
    expect(parseArgs(['dev', 'sessions'])).toEqual({ cmd: 'sessions', sub: 'list', all: false, maxAgeHours: undefined });
  });
  it('parses dev sessions reap --all', () => {
    expect(parseArgs(['dev', 'sessions', 'reap', '--all'])).toEqual({ cmd: 'sessions', sub: 'reap', all: true, maxAgeHours: undefined });
  });
  it('parses dev sessions reap --max-age-hours', () => {
    expect(parseArgs(['dev', 'sessions', 'reap', '--max-age-hours', '4'])).toEqual({ cmd: 'sessions', sub: 'reap', all: false, maxAgeHours: 4 });
  });
});
