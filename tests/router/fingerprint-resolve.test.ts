import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeAffordance, makeEdge } from '../../src/mapstore/types.js';
import { replayStep } from '../../src/router/replay.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const store = () => MapStore.fromDatabase(new Database(':memory:'));

describe('replayStep — elementFp resolution (the OrangeHRM heading-vs-button fix)', () => {
  // The live page has BOTH a heading "Login" and a button "Login" — name-only matching
  // would find 2 and escalate; role+name picks the button deterministically.
  const page = parseSnapshot([
    '- heading "Login" [ref=e10]',
    '- textbox "Username" [ref=e23]',
    '- button "Login" [ref=e32]',
  ].join('\n'));

  it('role+name fingerprint resolves the button, not the heading', () => {
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'log in', kind: 'navigate',
      elementFp: { role: 'button', name: 'Login' } });
    expect(replayStep(edge, page)).toEqual({ status: 'ok', ref: 'e32', repaired: false });
  });

  it('legacy (no elementFp) name-only edge still ESCALATES on the heading/button collision', () => {
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'log in by clicking "Login"', kind: 'navigate' });
    expect(replayStep(edge, page)).toEqual({ status: 'escalate' });   // 2 nodes named "Login" → strict miss
  });

  it('fingerprint with no live match escalates (drift)', () => {
    const edge = makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'x', kind: 'navigate',
      elementFp: { role: 'button', name: 'Submit' } });
    expect(replayStep(edge, page)).toEqual({ status: 'escalate' });
  });
});

describe('store — elementFp round-trips through projection + stored row', () => {
  it('projects an affordance elementFp + viaAffordance onto the edge', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_cart', label: 'open cart', kind: 'navigate', toState: 'sd:cart',
        elementFp: { role: 'link', name: 'cart', near: '2 items' } })] }));
    const e = s.edgesFrom('sd:inv')[0];
    expect(e.elementFp).toEqual({ role: 'link', name: 'cart', near: '2 items' });
    expect(e.viaAffordance).toBe('aff_cart');
  });

  it('a legacy affordance with no elementFp projects to elementFp:null (D4 — not undefined)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_x', label: 'go', kind: 'navigate', toState: 'sd:y' })] }));
    expect(s.edgesFrom('sd:inv')[0].elementFp).toBeNull();
  });

  it('stored edge row round-trips elementFp through upsert + reopen', () => {
    const db = new Database(':memory:');
    const s = MapStore.fromDatabase(db);
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate',
      elementFp: { role: 'button', name: 'Login', near: null } }));
    const reopened = MapStore.fromDatabase(db);
    const e = reopened.edgesFrom('a').find((x) => x.toState === 'b')!;
    expect(e.elementFp).toEqual({ role: 'button', name: 'Login', near: null });
  });
});

describe('store.recordElementFp — heal writes the owning affordance (B1)', () => {
  it('sets elementFp on the named affordance (no edge row needed) and re-resolves', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_cart', label: 'open cart', kind: 'navigate', toState: 'sd:cart' })] }));
    const ok = s.recordElementFp('sd:inv', 'aff_cart', { role: 'link', name: 'Cart', near: null });
    expect(ok).toBe(true);
    // the projected edge now carries the healed fingerprint — next walk resolves deterministically
    expect(s.edgesFrom('sd:inv')[0].elementFp).toEqual({ role: 'link', name: 'Cart', near: null });
  });

  it('recurses reveal children', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_menu', label: 'menu', kind: 'reveal', children: [
        makeAffordance({ id: 'aff_logout', label: 'Logout', kind: 'navigate', toState: 'sd:login' }),
      ] })] }));
    expect(s.recordElementFp('sd:inv', 'aff_logout', { role: 'link', name: 'Logout', near: null })).toBe(true);
    const inv = s.getState('sd:inv')!;
    expect(inv.affordances[0].children![0].elementFp).toEqual({ role: 'link', name: 'Logout', near: null });
  });

  it('returns false when the affordance is not found (caller falls back to selector_cache)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail' }));
    expect(s.recordElementFp('sd:inv', 'nope', { role: 'x', name: 'y', near: null })).toBe(false);
  });

  it('a heal on a projected _shell edge writes the fp onto the SHELL affordance, not the asking page', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:_shell', nodeId: 'n', semanticName: '_shell', urlPattern: 'https://n.example', role: 'shell',
      affordances: [makeAffordance({ id: 'sh_reports', label: 'Reports', kind: 'navigate', toState: 'n:report-list' })] }));
    s.upsertState(makeState({ id: 'n:report-list', nodeId: 'n', semanticName: 'report-list', urlPattern: '', role: 'section' }));
    s.upsertState(makeState({ id: 'n:downloads', nodeId: 'n', semanticName: 'downloads', urlPattern: '', role: 'section' }));
    const edge = s.edgesFrom('n:downloads').find((e) => e.toState === 'n:report-list')!;
    expect(edge.affordanceOwner).toBe('n:_shell');   // shell-projected edge carries its owner
    // heal exactly the way healStep does: target affordanceOwner ?? fromState
    const ok = s.recordElementFp(edge.affordanceOwner ?? edge.fromState, edge.viaAffordance!,
      { role: 'link', name: 'Reports', near: null });
    expect(ok).toBe(true);   // NOT silently dropped
    // the repair landed on the shell state's affordance…
    expect(s.getState('n:_shell')!.affordances[0].elementFp).toEqual({ role: 'link', name: 'Reports', near: null });
    // …so EVERY page's shell-projected edge now carries it
    expect(s.edgesFrom('n:downloads').find((e) => e.toState === 'n:report-list')!.elementFp)
      .toEqual({ role: 'link', name: 'Reports', near: null });
  });

  it('regression: healing a normal own edge still writes to its own state (affordanceOwner absent)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'sd:inv', nodeId: 'sd', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'aff_cart', label: 'open cart', kind: 'navigate', toState: 'sd:cart' })] }));
    const edge = s.edgesFrom('sd:inv')[0];
    expect(edge.affordanceOwner).toBeUndefined();
    const ok = s.recordElementFp(edge.affordanceOwner ?? edge.fromState, edge.viaAffordance!,
      { role: 'link', name: 'Cart', near: null });
    expect(ok).toBe(true);
    expect(s.getState('sd:inv')!.affordances[0].elementFp).toEqual({ role: 'link', name: 'Cart', near: null });
  });
});
