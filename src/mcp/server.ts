// MCP wrapper (Phase 5): serve webnav's verbs as Model Context Protocol tools
// over stdio, so MCP-native agents see them without shelling out. A THIN layer:
// tools are GENERATED from the cli-spec registry (one tool per verb — the spec
// stays the single source of truth) and every call executes the real CLI, so
// the CLI remains primary and the two surfaces cannot drift.
//
// Deliberate exception to the one-JSON-object-stdout rule: in `webnav mcp`
// server mode, stdout carries newline-delimited JSON-RPC 2.0 messages (the MCP
// stdio transport). Diagnostics still go to stderr.

import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CONSUMER_COMMANDS, DEV_COMMANDS, VERSION } from '../cli-spec.js';
import type { CommandSpec } from '../cli-spec.js';

// Long-running server modes can't be request/response tools.
const EXCLUDED = new Set(['dashboard', 'mcp']);

const PROTOCOL_VERSION = '2025-06-18';

interface JsonSchemaProp {
  type: 'string' | 'boolean' | 'array';
  description: string;
  items?: { type: 'string' };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProp>;
    required: string[];
  };
}

interface VerbTool extends McpTool {
  spec: CommandSpec;
  dev: boolean;
}

// `--to-cluster` → schema property `to_cluster` (and back, in argvFor).
const propName = (flag: string) => flag.replace(/^--/, '').replace(/-/g, '_');
const flagName = (prop: string) => '--' + prop.replace(/_/g, '-');

function toolFor(spec: CommandSpec, dev: boolean): VerbTool {
  const properties: Record<string, JsonSchemaProp> = {};
  const required: string[] = [];
  for (const a of spec.args) {
    properties[a.name] = { type: 'string', description: a.description };
    if (a.required) required.push(a.name);
  }
  for (const f of spec.flags) {
    const p = propName(f.name);
    if (f.name === '--input') {
      // Repeatable slot=value pairs (walk's runtime-only inputs).
      properties[p] = { type: 'array', items: { type: 'string' }, description: f.description };
    } else {
      properties[p] = {
        type: f.takesValue ? 'string' : 'boolean',
        description: f.description + (f.default !== undefined ? ` (default: ${f.default})` : ''),
      };
    }
  }
  return {
    name: 'webnav_' + (dev ? 'dev_' : '') + spec.name.replace(/-/g, '_'),
    description: spec.summary + ' Example: ' + spec.example,
    inputSchema: { type: 'object', properties, required },
    spec,
    dev,
  };
}

function verbTools(): VerbTool[] {
  return [
    ...CONSUMER_COMMANDS.filter((c) => !EXCLUDED.has(c.name)).map((c) => toolFor(c, false)),
    ...DEV_COMMANDS.filter((c) => !EXCLUDED.has(c.name)).map((c) => toolFor(c, true)),
  ];
}

/** The MCP tool list (schema only — what tools/list returns). */
export function mcpTools(): McpTool[] {
  return verbTools().map(({ spec: _s, dev: _d, ...tool }) => tool);
}

/** Rebuild the CLI argv for a tool call: positionals in spec order, then flags. */
export function argvFor(toolName: string, args: Record<string, unknown>): string[] {
  const tool = verbTools().find((t) => t.name === toolName);
  if (!tool) throw new Error(`unknown tool: ${toolName}`);
  const argv: string[] = tool.dev ? ['dev', tool.spec.name] : [tool.spec.name];
  for (const a of tool.spec.args) {
    const v = args[a.name];
    if (v !== undefined && v !== null) argv.push(String(v));
  }
  for (const f of tool.spec.flags) {
    const v = args[propName(f.name)];
    if (v === undefined || v === null) continue;
    if (f.name === '--input') {
      for (const pair of Array.isArray(v) ? v : [v]) argv.push('--input', String(pair));
    } else if (!f.takesValue) {
      if (v === true || v === 'true') argv.push(f.name);
    } else {
      argv.push(flagName(propName(f.name)), String(v));
    }
  }
  return argv;
}

/** Run the real CLI (the thin part: MCP never re-implements a verb). */
export type Executor = (argv: string[]) => Promise<{ stdout: string; code: number }>;

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const cliExecutor: Executor = (argv) =>
  new Promise((resolve) => {
    const child = execFile(
      join(ROOT, 'node_modules', '.bin', 'tsx'),
      [join(ROOT, 'src', 'cli.ts'), ...argv],
      { maxBuffer: 64 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        if (stderr) process.stderr.write(stderr);
        resolve({ stdout, code: child.exitCode ?? 0 });
      },
    );
  });

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Handle one JSON-RPC message; null = notification (no response). */
export async function handleMcpMessage(
  msg: JsonRpcRequest,
  exec: Executor = cliExecutor,
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string): JsonRpcResponse =>
    ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'webnav', version: VERSION },
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: mcpTools() });
    case 'tools/call': {
      const name = msg.params?.name as string;
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      let argv: string[];
      try {
        argv = argvFor(name, args);
      } catch (e) {
        return fail(-32602, (e as Error).message);
      }
      const { stdout, code } = await exec(argv);
      // Exit 2 = error; exit 3 = ran-fine-but-empty (a valid result, not an error).
      return reply({
        content: [{ type: 'text', text: stdout.trim() || '{}' }],
        isError: code === 2,
      });
    }
    default:
      return id === null ? null : fail(-32601, `method not found: ${msg.method}`);
  }
}

/** stdio loop: one JSON-RPC message per line in, one per line out. */
export function startMcpServer(exec: Executor = cliExecutor): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let pending = Promise.resolve();
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' },
        }) + '\n');
        return;
      }
      // Serialize handling so responses keep request order.
      pending = pending.then(async () => {
        const res = await handleMcpMessage(msg, exec);
        if (res) process.stdout.write(JSON.stringify(res) + '\n');
      });
    });
    rl.on('close', () => { void pending.then(resolve); });
  });
}
