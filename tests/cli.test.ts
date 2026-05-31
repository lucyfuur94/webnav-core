import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('parses recall with default top', () => {
    expect(parseArgs(['recall', 'python retry lib']))
      .toEqual({ cmd: 'recall', query: 'python retry lib', top: 10 });
  });
  it('parses --top', () => {
    expect(parseArgs(['recall', 'x', '--top', '5']))
      .toEqual({ cmd: 'recall', query: 'x', top: 5 });
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
