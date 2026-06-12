import { describe, it, expect } from 'vitest';
import { mcpTools, argvFor, handleMcpMessage } from '../../src/mcp/server.js';
import type { Executor } from '../../src/mcp/server.js';
import { parseArgs } from '../../src/cli.ts';

describe('mcp tool generation (from cli-spec — the single source of truth)', () => {
  it('exposes consumer verbs as webnav_<verb> and dev verbs as webnav_dev_<verb>', () => {
    const names = mcpTools().map((t) => t.name);
    expect(names).toContain('webnav_walk');
    expect(names).toContain('webnav_read');
    expect(names).toContain('webnav_walk_resume');
    expect(names).toContain('webnav_dev_outline');
    expect(names).toContain('webnav_dev_record_start');
  });

  it('excludes long-running server modes (dashboard, mcp itself)', () => {
    const names = mcpTools().map((t) => t.name);
    expect(names).not.toContain('webnav_dev_dashboard');
    expect(names).not.toContain('webnav_dev_mcp');
  });

  it('builds input schemas from the spec: required positionals, boolean flags, --input array', () => {
    const read = mcpTools().find((t) => t.name === 'webnav_read')!;
    expect(read.inputSchema.required).toContain('url');
    expect(read.inputSchema.properties.url.type).toBe('string');
    expect(read.inputSchema.properties.raw.type).toBe('boolean');

    const walk = mcpTools().find((t) => t.name === 'webnav_walk')!;
    expect(walk.inputSchema.properties.start.type).toBe('string');
    expect(walk.inputSchema.properties.input.type).toBe('array');
    expect(walk.inputSchema.properties.headless.type).toBe('boolean');
  });
});

describe('mcp argv reconstruction', () => {
  it('walk: flags + repeatable --input', () => {
    expect(argvFor('webnav_walk', {
      start: 'www.saucedemo.com:login',
      goal: 'www.saucedemo.com:checkout-complete',
      input: ['username=u', 'password=p'],
      headless: true,
    })).toEqual([
      'walk', '--start', 'www.saucedemo.com:login', '--goal', 'www.saucedemo.com:checkout-complete',
      '--input', 'username=u', '--input', 'password=p', '--headless',
    ]);
  });

  it('positionals keep spec order; dev verbs get the dev prefix', () => {
    expect(argvFor('webnav_type', { ref: 'e1', text: 'hello', session: 's1' }))
      .toEqual(['type', 'e1', 'hello', '--session', 's1']);
    expect(argvFor('webnav_dev_outline', { site: 'www.saucedemo.com' }))
      .toEqual(['dev', 'outline', 'www.saucedemo.com']);
  });

  it('multi-word flag names round-trip (to_cluster → --to-cluster)', () => {
    expect(argvFor('webnav_hop', { url: 'https://x.com', to_cluster: 'web-search' }))
      .toEqual(['hop', 'https://x.com', '--to-cluster', 'web-search']);
  });

  it('every generated argv parses with the real CLI parser (no drift)', () => {
    expect(parseArgs(argvFor('webnav_walk', { start: 'a', goal: 'b' })))
      .toMatchObject({ cmd: 'walk', start: 'a', goal: 'b' });
    expect(parseArgs(argvFor('webnav_dev_effects', { session: 'map-1' })))
      .toMatchObject({ cmd: 'effects', session: 'map-1' });
  });
});

describe('mcp json-rpc handling', () => {
  const stubExec = (stdout: string, code = 0): Executor => async () => ({ stdout, code });

  it('initialize advertises tools and echoes the protocol version', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      stubExec('{}'),
    );
    expect(res?.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'webnav' },
    });
  });

  it('notifications get no response', async () => {
    expect(await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' }, stubExec('{}'),
    )).toBeNull();
  });

  it('tools/list returns the generated tools', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, stubExec('{}'));
    const tools = (res?.result as { tools: { name: string }[] }).tools;
    expect(tools.length).toBeGreaterThan(20);
    expect(tools[0]).toHaveProperty('inputSchema');
  });

  it('tools/call runs the CLI and maps exit codes (2=error, 3=empty-but-ok)', async () => {
    const ok = await handleMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'webnav_list_goals', arguments: {} } },
      stubExec('{"status":"done"}', 0),
    );
    expect(ok?.result).toMatchObject({ isError: false, content: [{ type: 'text', text: '{"status":"done"}' }] });

    const empty = await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'webnav_list_goals', arguments: {} } },
      stubExec('{"status":"empty"}', 3),
    );
    expect(empty?.result).toMatchObject({ isError: false });

    const err = await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'webnav_list_goals', arguments: {} } },
      stubExec('{"status":"error"}', 2),
    );
    expect(err?.result).toMatchObject({ isError: true });
  });

  it('unknown tool → -32602; unknown method → -32601', async () => {
    const badTool = await handleMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'webnav_nope', arguments: {} } },
      stubExec('{}'),
    );
    expect(badTool?.error?.code).toBe(-32602);

    const badMethod = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, stubExec('{}'));
    expect(badMethod?.error?.code).toBe(-32601);
  });
});
