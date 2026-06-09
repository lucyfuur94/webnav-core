import { describe, it, expect } from 'vitest';
import { analyseCoverage, toOutline, toMermaid } from '../../src/graph/coverage.js';
import { makeState, makeAffordance } from '../../src/mapstore/types.js';

// A small saucedemo-shaped interior: login → inventory (with a reveal overlay
// whose About child is UNEXPLORED) → cart; plus a dead-end and an orphan to
// exercise the completeness cues.
function fixture() {
  return [
    makeState({ id: 'sd:login', nodeId: 'sd', semanticName: 'sd:login', urlPattern: '', role: 'detail',
      affordances: [
        makeAffordance({ id: 'u', label: 'enter Username', kind: 'input' }),
        makeAffordance({ id: 'p', label: 'enter Password', kind: 'input' }),
        makeAffordance({ id: 'go', label: 'click "Login"', kind: 'navigate', toState: 'sd:inventory', core: true }),
      ] }),
    makeState({ id: 'sd:inventory', nodeId: 'sd', semanticName: 'sd:inventory', urlPattern: '', role: 'detail',
      affordances: [
        makeAffordance({ id: 'cart', label: 'open cart', kind: 'navigate', toState: 'sd:cart', core: true }),
        makeAffordance({ id: 'sort', label: 'sort', kind: 'mutate' }),
        makeAffordance({ id: 'menu', label: 'open menu', kind: 'reveal', children: [
          makeAffordance({ id: 'about', label: 'About', kind: 'navigate', toState: null }),   // UNEXPLORED
          makeAffordance({ id: 'logout', label: 'Logout', kind: 'navigate', toState: 'sd:login' }),
        ] }),
      ] }),
    makeState({ id: 'sd:cart', nodeId: 'sd', semanticName: 'sd:cart', urlPattern: '', role: 'detail',
      affordances: [] }),   // DEAD-END: no outgoing navigation
    makeState({ id: 'sd:orphan', nodeId: 'sd', semanticName: 'sd:orphan', urlPattern: '', role: 'detail',
      affordances: [makeAffordance({ id: 'x', label: 'somewhere', kind: 'navigate', toState: 'sd:login' })] }),
  ];
}

describe('analyseCoverage', () => {
  it('counts affordances by kind (recursing into reveal children)', () => {
    const c = analyseCoverage('sd', fixture());
    expect(c.totals.states).toBe(4);
    expect(c.totals.input).toBe(2);
    expect(c.totals.mutate).toBe(1);
    expect(c.totals.reveal).toBe(1);
    // navigate: login.go, inventory.cart, menu.about, menu.logout, orphan.x = 5
    expect(c.totals.navigate).toBe(5);
    // mapped navigations exclude the unexplored About
    expect(c.totals.edges).toBe(4);
    expect(c.totals.unexplored).toBe(1);
  });

  it('flags the unexplored exit on its owning state', () => {
    const c = analyseCoverage('sd', fixture());
    const inv = c.states.find((s) => s.id === 'sd:inventory')!;
    expect(inv.unexplored).toContain('About');
  });

  it('flags dead-ends and orphans, and picks login as the entry', () => {
    const c = analyseCoverage('sd', fixture());
    expect(c.deadEnds).toContain('sd:cart');         // no outgoing nav
    expect(c.orphans).toContain('sd:orphan');         // nothing navigates to it
    expect(c.entry).toBe('sd:login');                 // named entry, despite Logout back-edge
  });
});

describe('toOutline', () => {
  it('renders a readable outline with the coverage summary + unexplored flag', () => {
    const out = toOutline('sd', fixture());
    expect(out).toContain('interior coverage');
    expect(out).toContain('4 states');
    expect(out).toContain('1 unexplored exits');
    expect(out).toMatch(/About.*UNEXPLORED/);
    expect(out).toMatch(/DEAD-END/);
    expect(out).toMatch(/ORPHAN/);
    // reveal children are indented under their opener
    expect(out).toContain('▸ reveal: open menu');
  });
});

describe('toMermaid', () => {
  it('emits a valid-shaped stateDiagram-v2 with entry, unexplored sink, commit tag', () => {
    const m = toMermaid('sd', fixture());
    expect(m.startsWith('stateDiagram-v2')).toBe(true);
    expect(m).toContain('[*] --> login');             // entry detection
    expect(m).toContain('login --> inventory');       // a real transition
    expect(m).toContain('--> unexplored');            // the About exit goes to the sink
    expect(m).toContain('unexplored : ❓ unexplored');
    // dead-end cart is marked terminal
    expect(m).toContain('cart --> [*]');
    // mermaid ids are sanitized (no colons)
    expect(m).not.toMatch(/sd:login/);
  });
});
