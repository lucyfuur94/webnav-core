import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveObserveLabel } from '../../src/cli.js';
import { makeState } from '../../src/mapstore/types.js';

const exec = promisify(execFile);
const DBDIR = mkdtempSync(join(tmpdir(), 'webnav-observe-'));
afterAll(() => rmSync(DBDIR, { recursive: true, force: true }));

// A typo'd --observe label must FAIL LOUDLY at walk start (exit 2 + a hint
// listing the node's known states), same posture as a bad --start/--goal — a
// silent drop returned a normal done with zero checkpoints and no signal.
// This errors BEFORE any browser opens (no network, no leaked daemon), so it's
// safe as a plain unit test despite spawning the real CLI.
describe('walk --observe — unknown label errors loudly', () => {
  it('bogus label → exit 2 + hint naming the label and listing known states', async () => {
    let code = 0; let stdout = '';
    try {
      await exec('npx', ['tsx', 'src/cli.ts', 'walk',
        '--start', 'www.saucedemo.com:login', '--goal', 'www.saucedemo.com:checkout-complete',
        '--observe', 'inventroy', '--headless'],
      { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, WEBNAV_DB: join(DBDIR, 'webnav.db') } });
    } catch (e: any) { code = e.code; stdout = e.stdout; }
    expect(code).toBe(2);
    const r = JSON.parse(stdout);
    expect(r.status).toBe('error');
    expect(r.hint).toContain('inventroy');                       // names the typo
    expect(r.hint).toContain('www.saucedemo.com:inventory');     // lists known states
  }, 30_000);
});

describe('resolveObserveLabel — valid labels resolve (id or bare semanticName)', () => {
  const states = [
    makeState({ id: 's.com:inventory', nodeId: 's.com', semanticName: 'inventory', urlPattern: '', role: 'detail' }),
    makeState({ id: 's.com:cart', nodeId: 's.com', semanticName: 'cart', urlPattern: '', role: 'detail' }),
  ];
  it('resolves a full state id', () => {
    expect(resolveObserveLabel(states, 's.com:cart')).toBe('s.com:cart');
  });
  it('resolves a bare semanticName to its state id', () => {
    expect(resolveObserveLabel(states, 'inventory')).toBe('s.com:inventory');
  });
  it('returns null for an unknown label', () => {
    expect(resolveObserveLabel(states, 'inventroy')).toBeNull();
  });
});
