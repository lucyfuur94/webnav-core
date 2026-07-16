import { describe, it, expect } from 'vitest';
import { hoverCandidates, runHoverProbe } from '../../src/recorder/hover-probe.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

// ── hoverCandidates: pure, structural, judgment-free ──────────────────────────
describe('hoverCandidates — structural candidate selection', () => {
  it('picks aria-haspopup nodes, menuitems, and named interactive nodes inside banner/navigation', () => {
    const yml = [
      '- banner [ref=e0]:',
      '  - button "Products" [ref=e1] [aria-haspopup=menu]',   // haspopup + inside banner
      '  - link "Docs" [ref=e2]',                               // named interactive inside banner
      '- navigation [ref=e3]:',
      '  - menuitem "Solutions" [ref=e4]',                      // menuitem inside nav
      '- main [ref=e5]:',
      '  - button "Buy now" [ref=e6]',                          // named interactive but NOT in a landmark, no haspopup → skip
      '  - combobox "Country" [ref=e7] [aria-haspopup=listbox]',// haspopup anywhere → pick
      '  - menuitem "Loose item" [ref=e8]',                     // menuitem anywhere → pick
      '  - paragraph "just text" [ref=e9]',                     // non-interactive → skip
    ].join('\n');
    const cands = hoverCandidates(parseSnapshot(yml)).map((n) => n.name);
    expect(cands).toContain('Products');
    expect(cands).toContain('Docs');
    expect(cands).toContain('Solutions');
    expect(cands).toContain('Country');
    expect(cands).toContain('Loose item');
    expect(cands).not.toContain('Buy now');   // main-landmark interactive, no haspopup
    expect(cands).not.toContain('just text'); // not interactive
  });

  it('skips ref-less nodes (can only hover a resolvable element)', () => {
    const yml = ['- banner:', '  - button "No ref" [aria-haspopup=menu]'].join('\n');
    expect(hoverCandidates(parseSnapshot(yml))).toHaveLength(0);
  });

  it('dedupes by ref and caps at the limit (default 12)', () => {
    const lines = ['- navigation [ref=e0]:'];
    for (let i = 1; i <= 20; i++) lines.push(`  - menuitem "Item ${i}" [ref=e${i}]`);
    const all = parseSnapshot(lines.join('\n'));
    expect(hoverCandidates(all)).toHaveLength(12);
    expect(hoverCandidates(all, 5)).toHaveLength(5);
    // a duplicate ref must not appear twice
    const dup = [...all, all[1]];
    const refs = hoverCandidates(dup, 50).map((n) => n.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

// ── runHoverProbe: scripted fake adapter + store ──────────────────────────────
// A candidate that reveals a flyout appends ONE ActionEffect (hover:true) + a ledger
// row stamped step:<seq>; a candidate that reveals nothing appends nothing.
function makeStore() {
  const effects: any[] = [];
  const events: { seq: number; kind: string; disposition: string | null; descriptor: any }[] = [];
  return {
    effects, events,
    isActive: () => true,
    appendEvent(_s: string, ev: any) { const seq = events.length; events.push({ seq, kind: ev.kind, disposition: null, descriptor: ev.descriptor }); return seq; },
    appendActionEffect(_s: string, fx: any) { const seq = effects.length; effects.push({ ...fx, seq }); return seq; },
    stampEvent(_s: string, seq: number, d: string) { const e = events.find((x) => x.seq === seq); if (e) e.disposition = d; },
  };
}

// A page with two candidates. Hovering e1 reveals a flyout (new menuitems); hovering
// e2 reveals nothing. The fake returns a bigger snapshot only after e1 is hovered.
// Padded past classifyReadiness's ready threshold (≥8 content nodes) so settleSnapshot
// returns without its loading-retry budget — keeps the unit test fast.
const BASE = ['- banner [ref=e0]:', '  - menuitem "Products" [ref=e1]', '  - menuitem "Empty" [ref=e2]',
  '- heading "Home" [ref=e3]', '- paragraph "Welcome one" [ref=e4]', '- paragraph "Welcome two" [ref=e5]',
  '- link "Docs" [ref=e6]', '- link "Blog" [ref=e7]', '- button "Sign in" [ref=e8]', '- listitem "Feature" [ref=e9]'].join('\n');
const FLYOUT = [BASE, '- menu [ref=e10]:', '  - menuitem "Widgets" [ref=e11]', '  - menuitem "Gadgets" [ref=e12]'].join('\n');

function makeAdapter() {
  const calls: string[] = [];
  let hovered: string | null = null;
  return {
    calls,
    async snapshot() { return hovered === 'e1' ? FLYOUT : BASE; },
    async hover(r: string) { calls.push('hover:' + r); hovered = r; },
    async rightClick(r: string) { calls.push('rightClick:' + r); hovered = r; },
    async press(k: string) { calls.push('press:' + k); hovered = null; },   // Escape neutralizes
    async currentUrl() { return 'https://mega.test/home'; },
  };
}

describe('runHoverProbe — probe loop', () => {
  it('records ONE reveal effect (hover:true) for the revealing candidate, nothing for the empty one', async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const res = await runHoverProbe({ adapter, store: store as any, sessionId: 'sess',
      limit: 12, rightClick: false, log: () => {} });
    expect(res.probed).toBe(2);
    expect(res.revealed).toBe(1);
    // exactly one effect, marked hover:true, on the right element, with the flyout in its diff
    expect(store.effects).toHaveLength(1);
    const fx = store.effects[0];
    expect(fx.action.hover).toBe(true);
    expect(fx.action.rightClick).toBeUndefined();
    expect(fx.action.name).toBe('Products');
    expect(fx.navigated).toBe(false);
    expect(fx.diff.added.some((n: any) => n.name === 'Widgets')).toBe(true);
    // ledger: one hover event stamped to the recorded step
    const stamped = store.events.filter((e) => e.kind === 'hover' && e.disposition?.startsWith('step:'));
    expect(stamped).toHaveLength(1);
  });

  it('right-click mode pins rightClick:true on the effect and uses rightClick on the adapter', async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    // In right-click mode the reveal trigger is e1 too (fake keys hovered on the ref).
    const res = await runHoverProbe({ adapter, store: store as any, sessionId: 'sess',
      limit: 12, rightClick: true, log: () => {} });
    expect(res.revealed).toBe(1);
    const fx = store.effects[0];
    expect(fx.action.rightClick).toBe(true);
    expect(fx.action.hover).toBeUndefined();
    expect(adapter.calls.some((c) => c.startsWith('rightClick:e1'))).toBe(true);
    expect(adapter.calls.some((c) => c.startsWith('hover:'))).toBe(false);
    // ledger kind is right-click
    expect(store.events.some((e) => e.kind === 'right-click')).toBe(true);
  });

  it('neutralizes between candidates so reveals do not stack', async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    await runHoverProbe({ adapter, store: store as any, sessionId: 'sess', limit: 12, rightClick: false, log: () => {} });
    // Escape (or a neutral re-hover) fires between the two candidates.
    expect(adapter.calls.some((c) => c.startsWith('press:Escape'))).toBe(true);
  });

  it('records nothing when no candidate reveals anything', async () => {
    const store = makeStore();
    const adapter = { ...makeAdapter(), async snapshot() { return BASE; } };
    const res = await runHoverProbe({ adapter, store: store as any, sessionId: 'sess', limit: 12, rightClick: false, log: () => {} });
    expect(res.probed).toBe(2);
    expect(res.revealed).toBe(0);
    expect(store.effects).toHaveLength(0);
  });
});
