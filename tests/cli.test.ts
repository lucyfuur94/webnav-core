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
});
