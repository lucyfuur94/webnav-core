import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('parses capture', () => {
    expect(parseArgs(['capture', 'https://github.com', 'out.yml']))
      .toEqual({ cmd: 'capture', url: 'https://github.com', out: 'out.yml' });
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
      .toEqual({ cmd: 'read', url: 'https://github.com/psf/requests', raw: false, browser: { headed: true } });
  });
  it('parses read --raw in either order (flag before url)', () => {
    expect(parseArgs(['read', '--raw', 'https://x.com']))
      .toEqual({ cmd: 'read', url: 'https://x.com', raw: true, browser: { headed: true } });
  });
  it('parses search --top', () => {
    expect(parseArgs(['search', 'x', '--top', '5']))
      .toEqual({ cmd: 'search', query: 'x', top: 5 });
  });
  it('walk/navigate/read default to HEADED (visible window)', () => {
    expect((parseArgs(['walk', '--start', 'a', '--goal', 'b']) as any).browser).toEqual({ headed: true });
    expect((parseArgs(['navigate', 'https://x']) as any).browser).toEqual({ headed: true });
    expect((parseArgs(['read', 'https://x']) as any).browser).toEqual({ headed: true });
  });
  it('--headless opts out of the headed default', () => {
    expect((parseArgs(['walk', '--start', 'a', '--goal', 'b', '--headless']) as any).browser)
      .toEqual({ headed: false });
    expect((parseArgs(['navigate', 'https://x', '--headless']) as any).browser).toEqual({ headed: false });
  });
  it('parses --persistent / --profile (implies persistent) / --browser (all headed by default)', () => {
    expect((parseArgs(['walk', '--start', 'a', '--goal', 'b', '--headed']) as any).browser)
      .toEqual({ headed: true });
    expect((parseArgs(['navigate', 'https://x', '--profile', '/tmp/p']) as any).browser)
      .toEqual({ headed: true, profile: '/tmp/p', persistent: true });
    expect((parseArgs(['read', 'https://x', '--browser', 'firefox']) as any).browser)
      .toEqual({ headed: true, browser: 'firefox' });
  });
  it('parses creds set/list/rm', () => {
    expect(parseArgs(['creds', 'set', 'site.com', 'username=u', 'password=p']))
      .toEqual({ cmd: 'creds', sub: 'set', site: 'site.com', key: undefined, values: { username: 'u', password: 'p' } });
    expect(parseArgs(['creds', 'list'])).toEqual({ cmd: 'creds', sub: 'list', site: undefined, key: undefined, values: {} });
    expect(parseArgs(['creds', 'rm', 'site.com', 'username']))
      .toEqual({ cmd: 'creds', sub: 'rm', site: 'site.com', key: 'username', values: {} });
  });
  it('parses node-add with comma-split capabilities/topics', () => {
    expect(parseArgs(['node-add', 'npmjs.com', '--url', 'https://www.npmjs.com',
      '--capabilities', 'package-search,registry', '--topics', 'javascript,packages']))
      .toEqual({ cmd: 'node-add', id: 'npmjs.com', url: 'https://www.npmjs.com',
        capabilities: ['package-search', 'registry'], topics: ['javascript', 'packages'] });
  });
  it('parses node-add with absent capabilities/topics as empty arrays', () => {
    expect(parseArgs(['node-add', 'npmjs.com', '--url', 'https://www.npmjs.com']))
      .toEqual({ cmd: 'node-add', id: 'npmjs.com', url: 'https://www.npmjs.com',
        capabilities: [], topics: [] });
  });
  it('parses edge-add with default kind', () => {
    expect(parseArgs(['edge-add', 'github.com', 'pypi.org']))
      .toEqual({ cmd: 'edge-add', from: 'github.com', to: 'pypi.org', kind: 'capability' });
  });
  it('parses edge-add --kind', () => {
    expect(parseArgs(['edge-add', 'github.com', 'pypi.org', '--kind', 'hyperlink']))
      .toEqual({ cmd: 'edge-add', from: 'github.com', to: 'pypi.org', kind: 'hyperlink' });
  });
  it('parses dashboard with default port', () => {
    expect(parseArgs(['dashboard'])).toEqual({ cmd: 'dashboard', port: 7777 });
  });
  it('parses dashboard --port override', () => {
    expect(parseArgs(['dashboard', '--port', '8080'])).toEqual({ cmd: 'dashboard', port: 8080 });
  });
  it('routes dashboard under the dev dispatcher', () => {
    expect(parseArgs(['dev', 'dashboard'])).toEqual(parseArgs(['dashboard']));
  });
  it('parses --help', () => { expect(parseArgs(['--help'])).toEqual({ cmd: 'help' }); });
  it('parses -h', () => { expect(parseArgs(['-h'])).toEqual({ cmd: 'help' }); });
  it('parses no args as help', () => { expect(parseArgs([])).toEqual({ cmd: 'help' }); });
  it('parses --version', () => { expect(parseArgs(['--version'])).toEqual({ cmd: 'version' }); });
  it('parses -V', () => { expect(parseArgs(['-V'])).toEqual({ cmd: 'version' }); });
  it('parses per-command help', () => {
    expect(parseArgs(['search', '--help'])).toEqual({ cmd: 'help', command: 'search' });
  });
  it('parses eval with url + js', () => {
    expect(parseArgs(['eval', 'https://x.com', '() => 1']))
      .toEqual({ cmd: 'eval', url: 'https://x.com', js: '() => 1' });
  });
  it('parses network with a url', () => {
    expect(parseArgs(['network', 'https://x.com']))
      .toEqual({ cmd: 'network', url: 'https://x.com' });
  });
  it('parses go-back with --session (the documented example)', () => {
    expect(parseArgs(['go-back', '--session', 'mysession']))
      .toEqual({ cmd: 'go-back', session: 'mysession' });
  });
  it('parses go-back with no session (default)', () => {
    expect(parseArgs(['go-back'])).toEqual({ cmd: 'go-back', session: undefined });
  });
  it('unknown verb throws with a --help hint', () => {
    expect(() => parseArgs(['bogus'])).toThrow(/--help/);
  });
});
