import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';

function freshStore(): MapStore {
  return MapStore.fromDatabase(new Database(':memory:'));
}

describe('editGraph — full typed affordance authoring', () => {
  it('authors navigate/reveal/mutate/input affordances incl. children, needs, core, addressableUrl', () => {
    const store = freshStore();
    editGraph(store, 'shop.example', {
      states: [
        { label: 'login', affordances: [
          { id: 'aff_user', label: 'enter Username', kind: 'input' },
          { id: 'aff_login', label: 'click Login', kind: 'navigate', to: 'inventory',
            needs: ['aff_user'], acceptsInput: 'credentials', core: true },
        ] },
        { label: 'inventory', affordances: [
          { id: 'aff_cart', label: 'open cart', kind: 'navigate', to: 'cart',
            addressableUrl: 'https://shop.example/cart', core: true },
          { id: 'aff_menu', label: 'open menu', kind: 'reveal', children: [
            { id: 'aff_logout', label: 'Logout', kind: 'navigate', to: 'login' },
            { id: 'aff_about', label: 'About', kind: 'navigate' },        // unexplored (no `to`)
          ] },
          'sort products',   // bare string → mutate
        ] },
        { label: 'cart' },
      ],
      edges: [],
    });
    const inv = store.getState('shop.example:inventory')!.affordances;
    const cart = inv.find((a) => a.id === 'aff_cart')!;
    expect(cart.kind).toBe('navigate');
    expect(cart.toState).toBe('shop.example:cart');        // `to` label resolved to full id
    expect(cart.addressableUrl).toBe('https://shop.example/cart');
    expect(cart.core).toBe(true);
    const menu = inv.find((a) => a.id === 'aff_menu')!;
    expect(menu.kind).toBe('reveal');
    expect(menu.children!.map((c) => c.label)).toEqual(['Logout', 'About']);
    expect(menu.children!.find((c) => c.id === 'aff_logout')!.toState).toBe('shop.example:login');
    expect(menu.children!.find((c) => c.id === 'aff_about')!.toState).toBeNull();  // unexplored
    expect(inv.find((a) => a.label === 'sort products')!.kind).toBe('mutate');
    // login's navigate affordance carries needs + core; projection sees it as a core edge.
    const loginEdges = store.edgesFrom('shop.example:login');
    expect(loginEdges.find((e) => e.toState === 'shop.example:inventory')!.core).toBe(true);
  });

  it('rejects a malformed affordance payload loudly (wrong field names)', () => {
    const store = freshStore();
    // An agent that uses `type`/`name` instead of `kind`/`label` must FAIL, not
    // silently store a `mutate:undefined` affordance (regression: dogfooding bug).
    expect(() => editGraph(store, 'x.com', {
      states: [{ label: 'a', affordances: [{ id: 'q', type: 'input', name: 'user' } as never] }],
      edges: [],
    })).toThrow(/missing a string "label"/);
    expect(() => editGraph(store, 'x.com', {
      states: [{ label: 'a', affordances: [{ label: 'go', kind: 'teleport' as never }] }],
      edges: [],
    })).toThrow(/invalid kind/);
  });

  it('creates the node if new and upserts states + edges', () => {
    const store = freshStore();
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'home', fingerprint: ['link'] }, { label: 'detail', urlPattern: 'example.com/*' }],
      edges: [{ from: 'home', to: 'detail', via: 'follow a result link' }],
    });
    expect(r).toMatchObject({ node: 'example.com', statesWritten: 2, edgesWritten: 1 });
    expect(store.getNode('example.com')).not.toBeNull();
    expect(store.getState('example.com:detail')!.nodeId).toBe('example.com');
    const edges = store.edgesFrom('example.com:home');
    expect(edges[0]).toMatchObject({ toState: 'example.com:detail', kind: 'navigate' });
  });

  it('marks a needsInput edge unclassified and records why in the step', () => {
    const store = freshStore();
    editGraph(store, 'example.com', {
      states: [{ label: 'detail' }, { label: 'login' }],
      edges: [{ from: 'detail', to: 'login', via: 'click Sign in', needsInput: true, why: 'requires credentials' }],
    });
    const e = store.edgesFrom('example.com:detail')[0];
    expect(e.kind).toBe('unclassified');
    expect(e.semanticStep).toContain('needs-input: requires credentials');
  });

  it('links to an already-stored state without re-declaring it', () => {
    const store = freshStore();
    editGraph(store, 'example.com', { states: [{ label: 'a' }], edges: [] });
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'b' }], edges: [{ from: 'b', to: 'a', via: 'go' }],
    });
    expect(r.edgesWritten).toBe(1);
    expect(store.edgesFrom('example.com:b')[0].toState).toBe('example.com:a');
  });

  it('persists requiresAffordances on an edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'example.com', {
      states: [{ label: 'inventory' }, { label: 'cart' }],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['add an item'] }],
    });
    const e = store.edgesFrom('example.com:inventory')[0];
    expect(e.requiresAffordances).toEqual(['add an item']);
  });

  it('authors affordances on a state, core on an edge, and node capabilities/topics', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      node: { capabilities: ['shopping-demo'], topics: ['shopping', 'demo'] },
      states: [{ label: 'inventory', affordances: ['add to cart', 'open menu'] }, { label: 'cart' }],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', core: true }],
    });
    // String affordances are stored as `mutate` affordances (safe default).
    const affs = store.getState('shop.example:inventory')!.affordances;
    expect(affs.map((a) => a.label)).toEqual(['add to cart', 'open menu']);
    expect(affs.every((a) => a.kind === 'mutate')).toBe(true);
    expect(store.edgesFrom('shop.example:inventory')[0].core).toBe(true);
    const node = store.getNode('shop.example')!;
    expect(node.capabilities).toEqual(['shopping-demo']);
    expect(node.topics).toEqual(['shopping', 'demo']);
  });
  it('does not clobber existing node capabilities when node metadata is omitted', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', { node: { capabilities: ['x'], topics: ['y'] }, states: [{ label: 'a' }], edges: [] });
    editGraph(store, 'shop.example', { states: [{ label: 'b' }], edges: [] });
    expect(store.getNode('shop.example')!.capabilities).toEqual(['x']);
  });

  it('throws on an edge endpoint that is neither in the payload nor stored', () => {
    const store = freshStore();
    expect(() => editGraph(store, 'example.com', {
      states: [{ label: 'a' }], edges: [{ from: 'a', to: 'ghost', via: 'go' }],
    })).toThrow(/ghost/);
  });
});

describe('editGraph — gates author needs on the affordance (source of truth)', () => {
  it('merges an edge requiresAffordances into the matching navigate affordance needs (no shadowing edge row)', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      states: [
        { label: 'inventory', affordances: [
          { id: 'aff_add', label: 'add to cart', kind: 'mutate' },
          { id: 'aff_cart', label: 'open cart', kind: 'navigate', to: 'cart' },
        ] },
        { label: 'cart' },
      ],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['aff_add'] }],
    });
    const inv = store.getState('shop.example:inventory')!;
    const aff = inv.affordances.find((a) => a.id === 'aff_cart')!;
    expect(aff.needs).toEqual(['aff_add']);
    // ONE edge, and it carries the gate — no ungated stored row shadows the projection.
    const edges = store.edgesFrom('shop.example:inventory');
    expect(edges).toHaveLength(1);
    expect(edges[0].requiresAffordances).toEqual(['aff_add']);
  });

  it('unions with pre-existing needs and merges core onto the affordance', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      states: [
        { label: 'inventory', affordances: [
          { id: 'aff_cart', label: 'open cart', kind: 'navigate', to: 'cart', needs: ['aff_add'] },
        ] },
        { label: 'cart' },
      ],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['aff_add', 'aff_coupon'], core: true }],
    });
    const aff = store.getState('shop.example:inventory')!.affordances[0];
    expect(aff.needs).toEqual(['aff_add', 'aff_coupon']);   // union, no duplicate
    expect(aff.core).toBe(true);                            // edge core merged onto the affordance
    expect(store.edgesFrom('shop.example:inventory')[0].core).toBe(true);
  });

  it('patches a STORED state when the from-state is not in this payload', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      states: [
        { label: 'inventory', affordances: [{ id: 'aff_cart', label: 'open cart', kind: 'navigate', to: 'cart' }] },
        { label: 'cart' },
      ],
      edges: [],
    });
    // Second edit: only the edge, against the stored inventory state.
    editGraph(store, 'shop.example', {
      states: [],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['aff_add'] }],
    });
    const aff = store.getState('shop.example:inventory')!.affordances[0];
    expect(aff.needs).toEqual(['aff_add']);
    expect(store.edgesFrom('shop.example:inventory')).toHaveLength(1);
  });

  it('still writes an edge row when NO matching affordance exists (back-compat) or when needsInput', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      states: [
        { label: 'inventory', affordances: [{ id: 'aff_cart', label: 'open cart', kind: 'navigate', to: 'cart' }] },
        { label: 'cart' }, { label: 'search' },
      ],
      edges: [
        // no affordance leads to 'search' → edge row keeps the gate
        { from: 'inventory', to: 'search', via: 'open search', requiresAffordances: ['aff_focus'] },
        // needsInput edges keep the stored-row path (unclassified semantics live on edges)
        { from: 'inventory', to: 'cart', via: 'open cart', needsInput: true, why: 'which item?' },
      ],
    });
    const edges = store.edgesFrom('shop.example:inventory');
    const toSearch = edges.find((e) => e.toState === 'shop.example:search')!;
    expect(toSearch.requiresAffordances).toEqual(['aff_focus']);
    expect(edges.some((e) => e.kind === 'unclassified')).toBe(true);
  });

  it('does NOT guess among multiple same-destination affordances when none matches the via label', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      states: [
        { label: 'checkout', affordances: [
          { id: 'aff_cancel', label: 'Cancel', kind: 'navigate', to: 'inventory' },
          { id: 'aff_logo', label: 'logo home link', kind: 'navigate', to: 'inventory' },
        ] },
        { label: 'inventory' },
      ],
      edges: [{ from: 'checkout', to: 'inventory', via: 'go back somehow', requiresAffordances: ['aff_x'] }],
    });
    // Ambiguous → falls back to the edge row; neither affordance gets the gate.
    const affs = store.getState('shop.example:checkout')!.affordances;
    expect(affs.every((a) => a.needs.length === 0)).toBe(true);
    const row = store.edgesFrom('shop.example:checkout').find((e) => e.semanticStep === 'go back somehow')!;
    expect(row.requiresAffordances).toEqual(['aff_x']);
  });
});

describe('editGraph — elementFp authoring', () => {
  it('round-trips an affordance elementFp through graph-edit into the projected edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'ohrm.example', {
      states: [
        { label: 'login', affordances: [
          { id: 'aff_login', label: 'log in', kind: 'navigate', to: 'dashboard',
            elementFp: { role: 'button', name: 'Login' } },
        ] },
        { label: 'dashboard' },
      ],
      edges: [],
    });
    const aff = store.getState('ohrm.example:login')!.affordances[0];
    expect(aff.elementFp).toEqual({ role: 'button', name: 'Login' });
    expect(store.edgesFrom('ohrm.example:login')[0].elementFp).toEqual({ role: 'button', name: 'Login' });
  });
});
