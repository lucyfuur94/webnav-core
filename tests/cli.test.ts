import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('parses recall with default top and default goal', () => {
    expect(parseArgs(['recall', 'python retry lib']))
      .toEqual({ cmd: 'recall', goal: 'github-repos', query: 'python retry lib', top: 10 });
  });
  it('parses recall --top', () => {
    expect(parseArgs(['recall', 'x', '--top', '5']))
      .toEqual({ cmd: 'recall', goal: 'github-repos', query: 'x', top: 5 });
  });
  it('parses recall with explicit goal', () => {
    expect(parseArgs(['recall', 'my-goal', 'search term']))
      .toEqual({ cmd: 'recall', goal: 'my-goal', query: 'search term', top: 10 });
  });
  it('parses capture', () => {
    expect(parseArgs(['capture', 'https://github.com', 'out.yml']))
      .toEqual({ cmd: 'capture', url: 'https://github.com', out: 'out.yml' });
  });
  it('parses locate', () => {
    expect(parseArgs(['locate', 'trending repositories']))
      .toEqual({ cmd: 'locate', place: 'trending repositories' });
  });
  it('parses list', () => {
    expect(parseArgs(['list'])).toEqual({ cmd: 'list' });
  });
  it('parses describe', () => {
    expect(parseArgs(['describe', 'trending repositories']))
      .toEqual({ cmd: 'describe', place: 'trending repositories' });
  });
  it('parses search with default top', () => {
    expect(parseArgs(['search', 'who won the 2018 world cup']))
      .toEqual({ cmd: 'search', query: 'who won the 2018 world cup', top: 3 });
  });
  it('parses read with the url first', () => {
    expect(parseArgs(['read', 'https://github.com/psf/requests']))
      .toEqual({ cmd: 'read', url: 'https://github.com/psf/requests', raw: false });
  });
  it('parses read --raw in either order (flag before url)', () => {
    expect(parseArgs(['read', '--raw', 'https://x.com']))
      .toEqual({ cmd: 'read', url: 'https://x.com', raw: true });
  });
  it('parses search --top', () => {
    expect(parseArgs(['search', 'x', '--top', '5']))
      .toEqual({ cmd: 'search', query: 'x', top: 5 });
  });
  it('parses route without capability', () => {
    expect(parseArgs(['route', 'find a python retry library']))
      .toEqual({ cmd: 'route', request: 'find a python retry library', capability: undefined });
  });
  it('parses route --capability', () => {
    expect(parseArgs(['route', 'x', '--capability', 'web-search']))
      .toEqual({ cmd: 'route', request: 'x', capability: 'web-search' });
  });
  it('parses route --cap alias', () => {
    expect(parseArgs(['route', 'x', '--cap', 'web-search']))
      .toEqual({ cmd: 'route', request: 'x', capability: 'web-search' });
  });
  it('parses hop --to-cluster', () => {
    expect(parseArgs(['hop', 'https://github.com/jd/tenacity', '--to-cluster', 'package-search']))
      .toEqual({ cmd: 'hop', url: 'https://github.com/jd/tenacity', toCluster: 'package-search', toNode: undefined });
  });
  it('parses hop --to-node', () => {
    expect(parseArgs(['hop', 'https://github.com/jd/tenacity', '--to-node', 'pypi.org']))
      .toEqual({ cmd: 'hop', url: 'https://github.com/jd/tenacity', toCluster: undefined, toNode: 'pypi.org' });
  });
  it('parses per-command help for route', () => {
    expect(parseArgs(['route', '--help'])).toEqual({ cmd: 'help', command: 'route' });
  });
  it('parses graph', () => {
    expect(parseArgs(['graph'])).toEqual({ cmd: 'graph' });
  });
  it('parses graph --json', () => {
    expect(parseArgs(['graph', '--json'])).toEqual({ cmd: 'graph' });
  });
  it('parses add-node with comma-split capabilities/topics', () => {
    expect(parseArgs(['add-node', 'npmjs.com', '--url', 'https://www.npmjs.com',
      '--capabilities', 'package-search,registry', '--topics', 'javascript,packages']))
      .toEqual({ cmd: 'add-node', id: 'npmjs.com', url: 'https://www.npmjs.com',
        capabilities: ['package-search', 'registry'], topics: ['javascript', 'packages'] });
  });
  it('parses add-node with absent capabilities/topics as empty arrays', () => {
    expect(parseArgs(['add-node', 'npmjs.com', '--url', 'https://www.npmjs.com']))
      .toEqual({ cmd: 'add-node', id: 'npmjs.com', url: 'https://www.npmjs.com',
        capabilities: [], topics: [] });
  });
  it('parses add-edge with default kind', () => {
    expect(parseArgs(['add-edge', 'github.com', 'pypi.org']))
      .toEqual({ cmd: 'add-edge', from: 'github.com', to: 'pypi.org', kind: 'capability' });
  });
  it('parses add-edge --kind', () => {
    expect(parseArgs(['add-edge', 'github.com', 'pypi.org', '--kind', 'hyperlink']))
      .toEqual({ cmd: 'add-edge', from: 'github.com', to: 'pypi.org', kind: 'hyperlink' });
  });
  it('parses --help', () => { expect(parseArgs(['--help'])).toEqual({ cmd: 'help' }); });
  it('parses -h', () => { expect(parseArgs(['-h'])).toEqual({ cmd: 'help' }); });
  it('parses no args as help', () => { expect(parseArgs([])).toEqual({ cmd: 'help' }); });
  it('parses --version', () => { expect(parseArgs(['--version'])).toEqual({ cmd: 'version' }); });
  it('parses -V', () => { expect(parseArgs(['-V'])).toEqual({ cmd: 'version' }); });
  it('parses per-command help', () => {
    expect(parseArgs(['recall', '--help'])).toEqual({ cmd: 'help', command: 'recall' });
  });
  it('unknown verb throws with a --help hint', () => {
    expect(() => parseArgs(['bogus'])).toThrow(/--help/);
  });
});
