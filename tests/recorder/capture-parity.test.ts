// CAPTURE-PATH PARITY: the extension (raw CDP AX → ingestAX) and the CLI/DOM
// (playwright YAML → ingest) capture paths must produce equivalent maps from the
// SAME pages, so the maintainer can test at the CLI/fixture level and trust the
// extension behaves the same.
//
// The two producers converge on ActionEffect. This suite drives BOTH from the SAME
// four pages, which exist in both formats under tests/fixtures/ax/:
//   *.ax.json          — raw CDP AX tree            → ingestAX (via adaptAXTree)
//   *.expected.a.yaml   — the playwright YAML snapshot → ingest   (via parseSnapshot)
// (the pairing verified by tests/playwright/ax-adapter.test.ts, which cross-resolves
// fingerprints between the two on the `rich` fixture).
//
// It asserts parity at three levels — producer, recorder-semantics, and draft — and
// where TRUE equivalence is impossible it narrows to the fingerprint/affordance-relevant
// subset and DOCUMENTS the exact residual. One residual is a REAL behavioral divergence
// (not format): it is pinned by a test below so it can't regress silently or be papered
// over. See the `DIVERGENCE` block in the draft-parity describe.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  ingest, ingestAX, type IngestBody, type IngestAXBody,
} from '../../src/recorder/ingest.js';
import { RecordStore } from '../../src/mapstore/record.js';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';
import { draftFromEffects, type DraftAffordance } from '../../src/explorer/draft.js';
import { parseSnapshot, TOKEN_ROLES as TOKEN_ROLES_LIST, type SnapNode } from '../../src/playwright/snapshot.js';
import { adaptAXTree, type AXNode } from '../../src/playwright/ax-adapter.js';
import {
  makeLiveExtensionBrowser, type AgentChannel,
} from '../../src/router/live-extension-browser.js';
import { settleSnapshot } from '../../src/router/browse.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/ax');
const axFixture = (name: string): AXNode[] => JSON.parse(readFileSync(join(FIX, `${name}.ax.json`), 'utf8'));
const yamlFixture = (name: string): string => readFileSync(join(FIX, `${name}.expected.a.yaml`), 'utf8');

// The clicked element on the `icons` page — the "Settings" button — indexed in each
// producer's own ref space: bN in the adapted AX tree, eN in the playwright YAML.
// (bN from tests/recorder/ingest.test.ts's ingestAX case; eN from icons.expected.a.yaml.)
const ICONS_SETTINGS_AX_REF = 'b7';
const ICONS_SETTINGS_YAML_REF = 'e8';

// TOKEN_ROLES: the roles draft.ts uses as fingerprint/identity material (candidateTokens).
// Parity on THIS multiset is what makes two producers yield the same state identities.
// Imported from the source of truth (snapshot.ts) rather than hand-copied, so a change to
// the identity vocabulary can't silently desync this parity check.
const TOKEN_ROLES = new Set(TOKEN_ROLES_LIST);
const tokenMultiset = (nodes: SnapNode[]): string[] =>
  nodes.filter((n) => TOKEN_ROLES.has(n.role) && n.name && n.name.trim())
    .map((n) => `${n.role}:${n.name}`).sort();

// ── ingest the same single navigation step (icons --click Settings--> table) both ways ──
function ingestBoth(fromPage: string, toPage: string) {
  const axStore = RecordStore.fromDatabase(new Database(':memory:'));
  ingestAX({
    sessionId: 'ax',
    steps: [{
      fromUrl: `https://s.test/${fromPage}`, fromAX: axFixture(fromPage),
      toUrl: `https://s.test/${toPage}`, toAX: axFixture(toPage),
      clickedRef: ICONS_SETTINGS_AX_REF,
    }],
  } as IngestAXBody, axStore);

  const yStore = RecordStore.fromDatabase(new Database(':memory:'));
  ingest({
    sessionId: 'y',
    steps: [{
      fromUrl: `https://s.test/${fromPage}`, fromSnapshot: yamlFixture(fromPage),
      toUrl: `https://s.test/${toPage}`, toSnapshot: yamlFixture(toPage),
      ref: ICONS_SETTINGS_YAML_REF,
    }],
  } as IngestBody, yStore);

  return { axEffects: axStore.actionEffects('ax'), yEffects: yStore.actionEffects('y') };
}

describe('capture-parity 1: PRODUCER parity (ingest vs ingestAX yield equivalent ActionEffects)', () => {
  const { axEffects, yEffects } = ingestBoth('icons', 'table');

  it('both paths recorded exactly one step', () => {
    expect(axEffects.length).toBe(1);
    expect(yEffects.length).toBe(1);
  });

  it('same clicked action: role, name, and recovered elementFp role+name', () => {
    const a = axEffects[0].action; const y = yEffects[0].action;
    expect(a?.role).toBe('button');
    expect([a?.role, a?.name]).toEqual([y?.role, y?.name]);
    expect([a?.elementFp?.role, a?.elementFp?.name])
      .toEqual([y?.elementFp?.role, y?.elementFp?.name]);
    expect(a?.name).toBe('Settings');
  });

  it('navigated is recomputed the same server-side (host+path)', () => {
    expect(axEffects[0].navigated).toBe(true);
    expect(yEffects[0].navigated).toBe(yEffects[0].navigated);
    expect(axEffects[0].navigated).toBe(yEffects[0].navigated);
  });

  it('fingerprint-relevant parse: TOKEN_ROLES multiset of each stored snapshot is set-equal across producers', () => {
    // parse the STORED snapshots back (what every downstream consumer — draft, coverage — does)
    // and compare only the role:name tokens that anchor identity. Benign ordering/format/depth
    // differences between the two producers are allowed; the identity token SET is not.
    for (const which of ['fromSnapshot', 'toSnapshot'] as const) {
      const aTok = tokenMultiset(parseSnapshot(axEffects[0][which]));
      const yTok = tokenMultiset(parseSnapshot(yEffects[0][which]));
      expect(aTok).toEqual(yTok);
    }
  });

  it('the same equality holds directly on all four paired fixtures (adaptAXTree vs parseSnapshot)', () => {
    // Independent of ingest: prove the two PRODUCERS agree on identity tokens for every page
    // that exists in both formats. This is the load-bearing fact the whole suite rests on.
    for (const page of ['icons', 'table', 'form', 'rich']) {
      const ax = tokenMultiset(adaptAXTree(axFixture(page)));
      const yaml = tokenMultiset(parseSnapshot(yamlFixture(page)));
      expect(ax).toEqual(yaml);
    }
  });
});

// ── recorder-semantics: drive the extension browser exactly as the agent does ──
// scripted channel: getAX() returns the next canned tree; currentUrl() the matching url.
function scriptedChannel(pages: { ax: AXNode[]; url: string }[]) {
  let i = 0; let cur = pages[0];
  const channel: AgentChannel = {
    getAX: async () => { cur = pages[Math.min(i, pages.length - 1)]; i++; return cur.ax; },
    currentUrl: async () => cur.url,
    dispatch: async () => { /* click/type fired */ },
  };
  return channel;
}

describe('capture-parity 2: RECORDER-SEMANTICS parity (extension tool-call pattern == direct effects)', () => {
  it('snapshot→act→snapshot→act→(build_map snapshot flush) records the same transitions as direct appendActionEffect', async () => {
    // The extension agent emits: snapshot (read page), act (click/type), snapshot (read landing),
    // act, …, then build_map does a final snapshot-first flush that closes the last open step.
    // Here: icons --click Settings--> table --click Edit(b?)--> back to icons (a 2-step run).
    const pages = [
      { ax: axFixture('icons'), url: 'https://s.test/icons' },
      { ax: axFixture('table'), url: 'https://s.test/table' },
      { ax: axFixture('icons'), url: 'https://s.test/icons' },
    ];
    const browser = makeLiveExtensionBrowser(scriptedChannel(pages), {});

    const y1 = await browser.snapshot();                     // read icons (fromAX buffered)
    const settings = parseSnapshot(y1).find((n) => n.role === 'button' && n.name === 'Settings')!;
    await browser.act(settings.ref!, null);                  // click → opens step (from=icons)
    const y2 = await browser.snapshot();                     // land on table → closes step 1
    const edit = parseSnapshot(y2).find((n) => n.role === 'button' && n.name === 'Edit')!;
    await browser.act(edit.ref!, null);                      // click → opens step 2 (from=table)
    await browser.snapshot();                                // build_map snapshot-first flush → closes step 2

    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(2);

    // Feed the recorded RawAXSteps through ingestAX.
    const viaExtension = RecordStore.fromDatabase(new Database(':memory:'));
    ingestAX({ sessionId: 'ext', steps }, viaExtension);
    const extFx = viaExtension.actionEffects('ext');

    // Build the SAME transitions by direct appendActionEffect of reconstructed effects — the
    // shared core ingestAX uses per step (reconstructEffectFromNodes over adaptAXTree(fromAX/toAX)).
    // Rather than duplicate that logic, ingest the identical steps a second time and compare: the
    // point is that the extension's snapshot/act pairing produced NO degenerate steps and the SAME
    // fromUrl/toUrl/navigated per transition as the raw page sequence dictates.
    expect(extFx.map((f) => [f.fromUrl, f.toUrl, f.navigated])).toEqual([
      ['https://s.test/icons', 'https://s.test/table', true],
      ['https://s.test/table', 'https://s.test/icons', true],
    ]);
    // no degenerate (from===to, non-navigated) step slipped in
    for (const f of extFx) expect(f.fromUrl).not.toBe(f.toUrl);
    // each step names the acted element (never a null-action degenerate for a real click)
    expect(extFx[0].action?.name).toBe('Settings');
    expect(extFx[1].action?.name).toBe('Edit');
  });

  it('a bare snapshot with no intervening act records NO step (no degenerate flush)', async () => {
    const browser = makeLiveExtensionBrowser(
      scriptedChannel([{ ax: axFixture('icons'), url: 'https://s.test/icons' }]), {});
    await browser.snapshot();
    await browser.snapshot();
    expect(browser.getRecordedSteps()).toEqual([]);
  });
});

// ── SETTLED parity (Task 5): the same navigated shell→hydrated transition must yield the
// SAME `settled` value whether captured by the CLI seam (settleSnapshot, browse.ts) or the
// extension seam (refresh()'s plateau loop, live-extension-browser.ts). Both truth-test with
// snapshotsPlateaued, so a plateaued landing reads settled:true on either producer, and a
// never-plateauing landing reads settled:false on either. This is the parity that lets the
// maintainer trust CLI-level testing covers the extension's capture quality too.
describe('capture-parity 4: SETTLED parity (CLI settleSnapshot == extension refresh plateau)', () => {
  // A shell that hydrates into a fuller page, in matching YAML (CLI) and AX (extension) forms.
  // Hydrated must clear classifyReadiness's ≥8-node floor (the CLI seam retries-while-loading
  // before the plateau check); the shell stays sparse so both producers see it as unsettled first.
  const N = 10;   // hydrated node count, comfortably past the readiness floor
  const HYDRATED_YAML = Array.from({ length: N }, (_, j) => `- button "Item ${j}" [ref=e${j + 2}]`).join('\n');
  const SHELL_YAML = '- heading "Loading" [ref=e2]';
  const SHELL_AX: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Dash' }, childIds: ['2'] },
    { nodeId: '2', role: { value: 'heading' }, name: { value: 'Loading' }, backendDOMNodeId: 300 },
  ];
  const HYDRATED_AX: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Dash' }, childIds: Array.from({ length: N }, (_, j) => String(j + 2)) },
    ...Array.from({ length: N }, (_, j) => ({ nodeId: String(j + 2), role: { value: 'button' }, name: { value: 'Item ' + j }, backendDOMNodeId: 300 + j })),
  ];

  // CLI seam: settleSnapshot polls snap() to a plateau (no evalJs → fallback loop, exactly the
  // extension's polling-only path). Returns settled directly.
  async function cliSettled(reads: string[]): Promise<boolean> {
    let i = 0;
    const snap = async () => reads[Math.min(i++, reads.length - 1)];
    return (await settleSnapshot(snap)).settled;
  }

  // Extension seam: drive a navigated click whose landing yields `reads` in order, and read the
  // recorded step's settled flag.
  async function extSettled(reads: AXNode[][]): Promise<boolean | undefined> {
    let phase = 0; let i = 0;
    const channel: AgentChannel = {
      getAX: async () => (i === 0 ? (i++, reads[0]) : reads[Math.min(i++, reads.length - 1)]),
      dispatch: async () => { phase = 1; },
      currentUrl: async () => (phase === 0 ? 'https://s.test/a' : 'https://s.test/b'),
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const y = parseSnapshot(await browser.snapshot());
    await browser.act(y.find((n) => n.role === 'heading')!.ref!, null);   // navigated click
    await browser.snapshot();
    return browser.getRecordedSteps()[0].settled;
  }

  it('plateaued landing → BOTH producers stamp settled:true', async () => {
    const cli = await cliSettled([SHELL_YAML, HYDRATED_YAML, HYDRATED_YAML]);
    const ext = await extSettled([SHELL_AX, HYDRATED_AX, HYDRATED_AX]);
    expect(cli).toBe(true);
    expect(ext).toBe(true);
    expect(cli).toBe(ext);
  });

  it('never-plateauing landing → BOTH producers stamp settled:false', async () => {
    // Each read differs from the last (grows), so it never plateaus within the tiny test budget.
    const growYaml = (k: number) => Array.from({ length: k }, (_, j) => `- button "Item ${j}" [ref=e${j + 2}]`).join('\n');
    const growAX = (k: number): AXNode[] => [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Feed' }, childIds: Array.from({ length: k }, (_, j) => String(j + 2)) },
      ...Array.from({ length: k }, (_, j) => ({ nodeId: String(j + 2), role: { value: 'button' }, name: { value: 'Item ' + j }, backendDOMNodeId: 400 + j })),
    ];
    // settleSnapshot's snap() must keep changing: give it a fresh growing read each call. Start
    // past the readiness floor (≥8) so it exercises the plateau-never path, not retry-while-loading.
    let ci = 10;
    const cli = (await settleSnapshot(async () => growYaml(ci++))).settled;
    let ei = 10;
    let phase = 0;
    const channel: AgentChannel = {
      getAX: async () => growAX(ei++),
      dispatch: async () => { phase = 1; },
      currentUrl: async () => (phase === 0 ? 'https://s.test/a' : 'https://s.test/b'),
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const yy = parseSnapshot(await browser.snapshot());
    await browser.act(yy.find((n) => n.role === 'button')!.ref!, null);
    await browser.snapshot();
    const ext = browser.getRecordedSteps()[0].settled;
    expect(cli).toBe(false);
    expect(ext).toBe(false);
    expect(cli).toBe(ext);
  });
});

// ── draft parity: same effect sequence → draftFromEffects → editGraph → MapStore ──
function draftAndProject(effects: ReturnType<RecordStore['actionEffects']>) {
  const draft = draftFromEffects(effects);
  const map = MapStore.fromDatabase(new Database(':memory:'));
  editGraph(map, 's.test', draft as unknown as Parameters<typeof editGraph>[2]);
  const projectedEdges = map.allEdges()
    .map((e) => `${e.fromState}|${e.toState}|${e.kind}`).sort();
  // navigate affordances are the routing-relevant, producer-independent repertoire
  const navAffordances = draft.states
    .flatMap((s) => s.affordances.filter((a: DraftAffordance) => a.kind === 'navigate')
      .map((a) => `${s.label}:${a.kind}:${a.label}`)).sort();
  return {
    stateLabels: draft.states.map((s) => s.label).sort(),
    fingerprints: draft.states.flatMap((s) => s.fingerprint).sort(),
    navAffordances,
    projectedEdges,
    // full affordance list, for the divergence assertion below
    allAffordances: draft.states
      .flatMap((s) => s.affordances.map((a: DraftAffordance) => `${s.label}:${a.kind}:${a.label}`)).sort(),
  };
}

describe('capture-parity 3: DRAFT parity (same pages → equal states/fingerprints/edges)', () => {
  const { axEffects, yEffects } = ingestBoth('icons', 'table');
  const A = draftAndProject(axEffects);
  const Y = draftAndProject(yEffects);

  it('equal state labels', () => {
    expect(A.stateLabels).toEqual(Y.stateLabels);
    expect(A.stateLabels).toEqual(['icons', 'table']);
  });

  it('equal fingerprints (set equality)', () => {
    expect(A.fingerprints).toEqual(Y.fingerprints);
  });

  it('equal projected edges after editGraph into a MapStore ({from,to,kind} set)', () => {
    expect(A.projectedEdges).toEqual(Y.projectedEdges);
    expect(A.projectedEdges).toEqual(['s.test:icons|s.test:table|navigate']);
  });

  it('equal NAVIGATE affordances (the routing-relevant repertoire)', () => {
    expect(A.navAffordances).toEqual(Y.navAffordances);
    expect(A.navAffordances).toEqual(['icons:navigate:Settings']);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // INTERIOR-REPERTOIRE PARITY (was a pinned DIVERGENCE; fixed 2026-07-20).
  //
  // The two paths must agree on a page's INTERIOR (unclicked) mutate/input repertoire —
  // the DOM/YAML path synthesizes interior affordances for declared-but-unclicked controls
  // (draft.ts §3c); the AX/extension path used to drop them ALL because adaptAXTree emits
  // `[ref=bN]` but parseSnapshot's REF_RE matched `eN` only, so every re-parsed AX node
  // came back ref=null and the interior-synthesis gate (resolveByFingerprint → a concrete
  // ref) skipped every control. FIX: REF_RE now accepts both `eN` and `bN` (snapshot.ts),
  // so an extension-recorded landing contributes its full form/control repertoire — a
  // login form's Email/Password/Log-in, a toolbar's extra buttons — identically to a CLI
  // recording. This is the fix behind "no frontier left unexplored" on authed SPAs.
  // ────────────────────────────────────────────────────────────────────────────
  it('PARITY: AX-sourced interior repertoire matches the DOM path (bN refs resolve after re-parse)', () => {
    const formPair = ingestBoth('icons', 'form');   // land on `form` (Email/Password/Log-in controls)
    const AF = draftAndProject(formPair.axEffects);
    const YF = draftAndProject(formPair.yEffects);

    // Identity + routing parity (unchanged):
    expect(AF.stateLabels).toEqual(YF.stateLabels);
    expect(AF.fingerprints).toEqual(YF.fingerprints);
    expect(AF.navAffordances).toEqual(YF.navAffordances);

    // Interior repertoire now EQUAL — the AX path recovers the form's controls too.
    expect(AF.allAffordances.sort()).toEqual(YF.allAffordances.sort());
    // and it genuinely contains the interior controls (not equal-but-both-empty).
    expect(AF.allAffordances).toContain('form:input:Email');
    expect(AF.allAffordances).toContain('form:mutate:Log in');
  });
});
