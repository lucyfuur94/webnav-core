import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptAXTree, adaptAXTreeWithRefs, type AXNode } from '../../src/playwright/ax-adapter.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { recoverFingerprint, resolveByFingerprint } from '../../src/playwright/fingerprint.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/ax');
const loadAX = (name: string): AXNode[] => JSON.parse(readFileSync(join(FIX, `${name}.ax.json`), 'utf8'));
const loadExpected = (name: string) => parseSnapshot(readFileSync(join(FIX, `${name}.expected.a.yaml`), 'utf8'));

const DROP_ROLES = ['RootWebArea', 'StaticText', 'InlineTextBox', 'LineBreak', 'none', 'presentation', 'option', 'MenuListPopup', 'LabelText', 'Legend'];

describe('adaptAXTree — DROP set (all fixtures)', () => {
  for (const fixture of ['icons', 'table', 'form', 'rich']) {
    it(`${fixture}: emits none of the dropped roles`, () => {
      const adapted = adaptAXTree(loadAX(fixture));
      for (const dropped of DROP_ROLES) {
        expect(adapted.map((n) => n.role)).not.toContain(dropped);
      }
    });
  }
});

describe('adaptAXTree — icons fixture', () => {
  const adapted = adaptAXTree(loadAX('icons'));

  it('maps image -> img', () => {
    const imgs = adapted.filter((n) => n.role === 'img');
    expect(imgs.length).toBeGreaterThan(0);
  });

  it('preserves names and assigns synthetic refs to every kept node', () => {
    const heading = adapted.find((n) => n.role === 'heading');
    expect(heading?.name).toBe('Icon toolbar');
    for (const n of adapted) expect(n.ref).toMatch(/^b\d+$/);
  });

  it('preserves the link url (CDP resolves it absolute; playwright keeps the raw href — both carry the destination)', () => {
    const link = adapted.find((n) => n.role === 'link');
    expect(link?.name).toBe('Continue');
    expect(link?.url).toMatch(/\/next$/);
  });
});

describe('adaptAXTree — rich-controls fixture (spike condition #2)', () => {
  const adapted = adaptAXTree(loadAX('rich'));
  const expectedA = loadExpected('rich');

  it('never surfaces select option VALUES (India/USA/Mongolia) — the no-values rule', () => {
    const names = adapted.map((n) => n.name);
    expect(names).not.toContain('India');
    expect(names).not.toContain('USA');
    expect(names).not.toContain('Mongolia');
  });

  it('maps every hardened interactive role to the ARIA token playwright emits', () => {
    const roles = new Set(adapted.map((n) => n.role));
    for (const role of ['checkbox', 'radio', 'switch', 'combobox', 'menu', 'menuitem', 'menuitemcheckbox', 'button']) {
      expect(roles.has(role)).toBe(true);
    }
  });

  it('cross-resolves every interactive node both directions, zero wrong-resolve (12/12)', () => {
    const INTERACTIVE = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'menuitemcheckbox', 'switch']);
    const interactiveInA = expectedA.filter((n) => n.ref && INTERACTIVE.has(n.role));
    expect(interactiveInA.length).toBeGreaterThan(0);

    let bToAOk = 0;
    for (const target of adapted.filter((n) => INTERACTIVE.has(n.role))) {
      const fp = recoverFingerprint(adapted, target.ref!);
      expect(fp).not.toBeNull();
      const resolved = resolveByFingerprint(fp!, expectedA);
      expect(resolved).not.toBeNull();
      const match = expectedA.find((n) => n.ref === resolved);
      expect(match?.role).toBe(target.role);
      expect(match?.name).toBe(target.name);
      bToAOk++;
    }
    expect(bToAOk).toBe(interactiveInA.length);

    let aToBOk = 0;
    for (const target of interactiveInA) {
      const fp = recoverFingerprint(expectedA, target.ref!);
      expect(fp).not.toBeNull();
      const resolved = resolveByFingerprint(fp!, adapted);
      expect(resolved).not.toBeNull();
      const match = adapted.find((n) => n.ref === resolved);
      expect(match?.role).toBe(target.role);
      expect(match?.name).toBe(target.name);
      aToBOk++;
    }
    expect(aToBOk).toBe(interactiveInA.length);
  });
});

describe('adaptAXTree — table + form fixtures (parity smoke)', () => {
  it('table: rows/cells/buttons survive with names intact', () => {
    const adapted = adaptAXTree(loadAX('table'));
    expect(adapted.filter((n) => n.role === 'row').length).toBeGreaterThan(0);
    expect(adapted.some((n) => n.role === 'button' && n.name === 'Edit')).toBe(true);
    expect(adapted.some((n) => n.role === 'button' && n.name === 'Delete')).toBe(true);
  });

  it('form: textboxes keep their accessible names', () => {
    const adapted = adaptAXTree(loadAX('form'));
    expect(adapted.some((n) => n.role === 'textbox' && n.name === 'Email')).toBe(true);
    expect(adapted.some((n) => n.role === 'textbox' && n.name === 'Password')).toBe(true);
  });
});

describe('adaptAXTreeWithRefs — ref→nodeId map', () => {
  it('rich fixture: adaptAXTreeWithRefs nodes deep-equal adaptAXTree (zero behavior change)', () => {
    const axNodes = loadAX('rich');
    const adapted = adaptAXTree(axNodes);
    const { nodes: adaptedWithRefs } = adaptAXTreeWithRefs(axNodes);
    expect(adaptedWithRefs).toEqual(adapted);
  });

  it('rich fixture: every emitted node ref maps to the correct nodeId from source', () => {
    const axNodes = loadAX('rich');
    const { nodes, refMap } = adaptAXTreeWithRefs(axNodes);

    // For every node in the output, refMap must contain its ref with the correct nodeId
    for (const node of nodes) {
      const mapEntry = refMap.get(node.ref);
      expect(mapEntry).toBeDefined();
      expect(mapEntry?.nodeId).toBeDefined();

      // Find the original AXNode to verify it matches
      const original = axNodes.find((n) => n.nodeId === mapEntry?.nodeId);
      expect(original).toBeDefined();
      expect(original?.ignored).toBe(false);
      expect(original?.role?.value).toBeTruthy();
    }
  });

  it('rich fixture: refMap includes backendDOMNodeId when present in source', () => {
    const axNodes = loadAX('rich');
    const { nodes, refMap } = adaptAXTreeWithRefs(axNodes);

    // Find a node with backendDOMNodeId that is also kept (not ignored, not dropped role)
    const DROP_SET = new Set(DROP_ROLES);
    const keptNodeWithBackendId = axNodes.find(
      (n) => !n.ignored && n.backendDOMNodeId !== undefined && n.role?.value && !DROP_SET.has(n.role.value),
    );
    expect(keptNodeWithBackendId).toBeDefined();

    if (keptNodeWithBackendId) {
      // Find the corresponding output node via refMap
      let foundInMap = false;
      for (const [ref, mapEntry] of refMap) {
        if (mapEntry.nodeId === keptNodeWithBackendId.nodeId) {
          expect(mapEntry.backendDOMNodeId).toBe(keptNodeWithBackendId.backendDOMNodeId);
          foundInMap = true;
          break;
        }
      }
      expect(foundInMap).toBe(true);
    }
  });

  it('dropped/ignored nodes never appear in refMap', () => {
    const axNodes = loadAX('rich');
    const { nodes, refMap } = adaptAXTreeWithRefs(axNodes);

    // Collect all nodeIds that appear in the refMap
    const mappedNodeIds = new Set(Array.from(refMap.values()).map((v) => v.nodeId));

    // Every mapped nodeId must exist in the output nodes (double-check)
    for (const nodeId of mappedNodeIds) {
      const inOutput = nodes.some((n) => {
        const mapEntry = refMap.get(n.ref);
        return mapEntry?.nodeId === nodeId;
      });
      expect(inOutput).toBe(true);
    }

    // No dropped/ignored nodes should have ended up in the map
    for (const original of axNodes) {
      if (original.ignored || !original.role?.value || DROP_ROLES.includes(original.role.value)) {
        // This node should NOT be in the refMap
        const inMap = Array.from(refMap.values()).some((v) => v.nodeId === original.nodeId);
        expect(inMap).toBe(false);
      }
    }
  });

  it('synthetic test: inline AXNode with backendDOMNodeId threads through correctly', () => {
    const testNodes: AXNode[] = [
      {
        nodeId: 'root',
        ignored: false,
        role: { value: 'region' },
        name: { value: 'Test Region' },
        childIds: ['child1'],
      },
      {
        nodeId: 'child1',
        ignored: false,
        role: { value: 'button' },
        name: { value: 'Click Me' },
        backendDOMNodeId: 999,
        parentId: 'root',
      },
    ];

    const { nodes, refMap } = adaptAXTreeWithRefs(testNodes);
    expect(nodes.length).toBe(2);

    // Find the button node
    const buttonNode = nodes.find((n) => n.role === 'button');
    expect(buttonNode).toBeDefined();
    expect(buttonNode?.name).toBe('Click Me');

    // Verify refMap includes the backendDOMNodeId
    const mapEntry = refMap.get(buttonNode!.ref);
    expect(mapEntry?.nodeId).toBe('child1');
    expect(mapEntry?.backendDOMNodeId).toBe(999);
  });
});
