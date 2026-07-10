import type { StoredActionEffect } from '../mapstore/record.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { matchState, hasToken } from './fingerprint.js';
import { resolveByFingerprint, type ElementFingerprint } from '../playwright/fingerprint.js';
import { makeState, type State, type DeclaredShadow } from '../mapstore/types.js';
import { extractShadow } from './shadow.js';
import { inferUrlModel, proposeTemplates, faceOf, jaccard, templateCore, type Face } from './infer.js';
import { classifyReadiness } from '../router/readiness.js';

// draftFromEffects: fold a recorded walk-through (action-effects: fromUrl/toUrl/toSnapshot/
// action.elementFp) into a ready-to-edit graph-edit spec — absolute URLs, uniqueness-driven
// fingerprints, and edges that actually resolve — so learning a site is "drive once, accept a
// SELF-VERIFIED draft", never the hand-author-then-thrash loop. Pure + deterministic (#5a: no
// LLM; the agent still renames/curates the draft, it just doesn't reverse-engineer selectors).
// Design + the two blocking fixes this implements: 2026-06-13-graph-analyse-draft-design.md.

// The graph-edit-shaped draft (what graph-edit --graph accepts; agent curates then pipes it).
export interface DraftAffordance {
  id: string; label: string; kind: 'navigate' | 'input' | 'mutate' | 'reveal';
  to?: string; elementFp?: ElementFingerprint; acceptsInput?: string; needs?: string[]; core?: boolean;
  children?: DraftAffordance[];     // reveal: the ARIA-named affordances the overlay exposed
  needsClassification?: boolean;    // label matched a commit-word → agent classifies (commit stays false, #2/#5a)
}

// Roles that count as a real, resolvable child of a revealed overlay (ARIA role + name only;
// NEVER an inferred purpose — review-bounded #5a). A revealed node outside this set is dropped,
// not guessed.
const REVEAL_CHILD_ROLES = new Set(['button', 'menuitem', 'link', 'tab', 'checkbox', 'combobox', 'textbox']);
// Conservative commit-word match on a DECLARED label — surfaces a CANDIDATE for the agent to
// classify; it is a string match, not a judgment (commit is never auto-set true, #2/#5a).
// (live finding 2026-07-07: a human recording fired saucedemo's "Finish" — the order-placing
// button — and it drafted as a PLAIN navigate a walk would auto-fire, violating #2. finish/
// purchase/buy/send added; still only a CANDIDATE flag the agent classifies, #5a.)
export const COMMIT_WORDS = /\b(delete|remove|save|submit|confirm|place\s*order|pay|apply|finish|purchase|buy|send)\b/i;
export interface DraftState {
  label: string; urlPattern: string; fingerprint: string[]; affordances: DraftAffordance[];
  declaredShadow?: DeclaredShadow;   // Layer 2: declared domain-shadow evidence (collections/filters/...)
  role?: 'hub' | 'section' | 'detail';  // site-tree level, derived from the OBSERVED nav structure
  parentState?: string | null;       // the section/page this drills DOWN from (label); null = top-level
  provisional?: string | null;       // seen once — core is unseparated data-vs-structure; record again
  _warning?: string;   // self-verify flag: non-unique fingerprint / unresolvable edge — agent curates
}
// A landing the draft could NOT place as a clean state — a 404/error page, or a page with no
// distinctive content (its only tokens are shared sidebar chrome, so it can't be told apart
// from every other logged-in page). Returned SEPARATELY from `states` so it neither pollutes
// the good states' fingerprints nor blocks the whole map — the agent decides what to do with
// each (re-record without the dead route, or accept it's genuinely broken). #5a "your move".
export interface DegenerateState { label: string; urlPattern: string; reason: string; affordances: number; }
export interface DraftGraph {
  node?: { capabilities?: string[]; topics?: string[] };
  states: DraftState[]; edges: never[];
  needsFix?: DegenerateState[];   // landings held out (404 / no distinctive fingerprint)
  receipt: { entry: string | null; states: string[]; walkExample: string | null; requests: string[] };
}

// candidate fingerprint tokens for a page, most-distinctive first: headings, then
// buttons/textboxes/links with names. (role:name; the vocabulary matchState matches on.)
// Role priority for fingerprint candidates, MOST page-identifying first. `tab` is second
// (after heading) because a page's tab-set is structural + durable — e.g. a report builder
// with no heading is still uniquely identified by tab:Table + tab:Charts, without falling
// back to data-specific buttons (a particular report's "OS Remove"). `tablist` groups tabs;
// its children carry the names.
const TOKEN_ROLES = ['heading', 'tab', 'button', 'textbox', 'link', 'checkbox', 'combobox'];
function candidateTokens(nodes: SnapNode[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  // headings first (most page-identifying), then the rest in role priority, doc order within.
  for (const role of TOKEN_ROLES) {
    for (const n of nodes) {
      if (n.role !== role || !n.name || !n.name.trim()) continue;
      const tok = `${role}:${n.name}`;
      if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
  }
  return out;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'state';

// A landing is an ERROR page if a heading announces not-found/error. Generic (no site
// specifics); a real page whose heading legitimately contains "error" (rare) is a tolerable
// false positive — it surfaces as needs-fix for the agent, never a silent drop.
const ERROR_HEADING = /\b(page not found|not found|404|something went wrong|no access|access denied|unauthorized)\b/i;
function isErrorLanding(nodes: SnapNode[]): boolean {
  return nodes.some((n) => n.role === 'heading' && n.name != null && ERROR_HEADING.test(n.name));
}

// map an interactive ARIA role to its in-page affordance kind (strict, no layout inference):
// fillable fields → input; everything else interactive → mutate. (link-to-known-state is handled
// by the cross-link mesh, not here.)
const INPUT_ROLES = new Set(['textbox', 'combobox', 'checkbox', 'searchbox', 'spinbutton']);
function childKind(role: string): DraftAffordance['kind'] { return INPUT_ROLES.has(role) ? 'input' : 'mutate'; }
// Label from the STABLE path (ids already stripped) so a state reads `report` / `dashboard`,
// not `7001-bd5a1a4a…` (the raw record id). Uses the last 1-2 non-account segments.
function host(url: string): string | null { try { return new URL(url).host; } catch { return null; } }

// Label from the non-{param} tail segments (≤2) of a template/key path so a state reads
// `report-list` / `dashboard`, not the raw record id. `/` → `home`. No numeric suffixes.
function labelFromKey(key: string): string {
  const segs = key.split('/').filter(Boolean).filter((s) => s !== '{param}');
  return slug(segs.slice(-2).join('-') || 'home');
}
// The first `heading:` core token NOT shared by any of the `others` cores — the distinguishing
// heading used to name an SPA split / break a label collision. null if none distinguishes.
function distinguishingHeading(core: Face, others: Face[]): string | null {
  for (const t of core) {
    if (!t.startsWith('heading:')) continue;
    if (others.every((o) => !o.has(t))) return t.slice('heading:'.length);
  }
  return null;
}
// Single-link clustering of faces at a jaccard threshold (union-find over the ≥t edges).
// Returns clusters as index groups. One key with structurally-distinct landings splits into
// >1 cluster (SPA views at one URL); same-structure repeat visits stay in one cluster.
function clusterFaces(faces: Face[], t: number): number[][] {
  const parent = faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    if (jaccard(faces[i], faces[j]) >= t) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));
  return [...groups.values()];
}

// STABLE page identity — the key that makes one logical page ONE state regardless of what's
// currently shown on it. A page is identified by its URL PATHNAME with the volatile parts
// removed: (a) query string + hash (a `?currentTab=`/sort/filter is an in-page mutate, not a
// new page), and (b) trailing ID-ish path segments (`/report/7001/<hash>` and its Flat/Nested
// viz variants, `/dashboard/8001` — the collection is the page; the specific record/sub-view is
// state ON it). Generic: any run of trailing segments that look like ids (digits, hashes, uuids)
// collapses to the collection path. NOT site-specific. Two DIFFERENT records of the same
// collection therefore share one state coordinate (correct per the affordance model — same
// page-type, reached by the same route; the record id is a runtime input, not map structure).
// A logical page: identified by its aliased URL key, defined by its SETTLED READY landings.
// - landings/faces: only navigated + classifyReadiness==='ready' snapshots feed identity
//   (Task 9 uses non-nav toSnapshots for affordances only — NOT here).
// - core/coreNodes: the durable face (templateCore, minus shell — shell arrives Task 8) + the
//   first landing filtered to core.
// - nodes/fpNodes: bridge fields the affordance/hierarchy/self-verify sections consume —
//   nodes = union of every landing (full repertoire), fpNodes = first landing (fingerprint src).
interface PageInfo {
  key: string; url: string; template: string | null; label: string;
  landings: SnapNode[][]; faces: Face[]; core: Face; coreNodes: SnapNode[]; provisional: string | null;
  nodes: SnapNode[]; fpNodes: SnapNode[];
}

/**
 * Build a draft graph from recorded action-effects. Observation-based identity (2026-07-10):
 *  1. KEY: infer the site's URL model from every observed url; alias a pre-redirect ghost
 *     (requestedUrl ≠ settled toUrl) to the settled key so the ghost merges. `key(url)` =
 *     follow-alias(keyOf(url)) — Task 8's mesh reuses it.
 *  2. LANDINGS: a page's identity landings = navigated toSnapshots (+ the first effect's
 *     fromSnapshot) that classifyReadiness==='ready'. Non-nav toSnapshots feed affordances
 *     only (Task 9), not identity.
 *  3. PROPOSE/DISPOSE: proposeTemplates over the keys; a group merges iff every member's
 *     first-landing face is jaccard≥0.5 with the group's first member — same-structure param
 *     URLs collapse, a list-vs-detail pair does not.
 *  4. SPA SPLIT: within one key with ≥2 landings, cluster faces at jaccard≥0.5; >1 cluster →
 *     split states named by a distinguishing heading (else needsFix).
 *  5. CORE: templateCore(faces) minus shell (shell arrives Task 8); coreNodes = first landing
 *     filtered to core tokens.
 *  6. NAME: labelFromKey(template ?? key); collisions broken by a distinguishing core heading
 *     (else both to needsFix). NO numeric suffixes.
 * Then (unchanged, some re-pointed in Tasks 8–10): uniqueness fingerprint, affordance synthesis,
 * hierarchy, self-verify, needsFix assembly.
 */
export function draftFromEffects(effects: StoredActionEffect[]): DraftGraph {
  // ── 1. KEY: URL model + alias map (rule 1) ──
  const allUrls: string[] = [];
  effects.forEach((e, i) => {
    if (i === 0 && e.fromUrl) allUrls.push(e.fromUrl);
    if (e.toUrl) allUrls.push(e.toUrl);
    if (e.requestedUrl) allUrls.push(e.requestedUrl);
  });
  const model = inferUrlModel(allUrls);
  const alias = new Map<string, string>();   // requested key → settled key (pre-redirect ghost)
  for (const e of effects) {
    if (!e.navigated || !e.requestedUrl) continue;
    const rk = model.keyOf(e.requestedUrl), sk = model.keyOf(e.toUrl);
    if (rk !== sk) alias.set(rk, sk);
  }
  const key = (url: string): string => { const k = model.keyOf(url); return alias.get(k) ?? k; };

  // ── 2. LANDINGS: gather ready landing snapshots per key (rule 2) ──
  // landingsByKey: identity landings (navigated + ready toSnapshots, + the FIRST effect's
  // fromSnapshot = the entry). A page with NO ready landing never becomes a state (rule 2).
  // urlByKey: the FIRST observed full URL for a key → the merged page's urlPattern. Non-nav
  // toSnapshots are NOT landings — they feed affordance synthesis (Task 9), read from the raw
  // effect there, not from this map.
  const ready = (snap: string) => classifyReadiness(snap) === 'ready';
  const landingsByKey = new Map<string, SnapNode[][]>();
  const urlByKey = new Map<string, string>();          // first full URL observed for a key
  const pushLanding = (url: string, snap: string) => {
    if (!ready(snap)) return;
    const k = key(url);
    (landingsByKey.get(k) ?? landingsByKey.set(k, []).get(k)!).push(parseSnapshot(snap));
    if (!urlByKey.has(k)) urlByKey.set(k, url);
  };
  effects.forEach((e, i) => {
    if (i === 0 && e.fromSnapshot) pushLanding(e.fromUrl, e.fromSnapshot);   // the entry page
    if (e.navigated && e.toSnapshot) pushLanding(e.toUrl, e.toSnapshot);
  });

  // ── 3. PROPOSE/DISPOSE templates (rule 3) ──
  // Group keys by proposeTemplates; a group MERGES only when every member's first-landing face
  // is structurally close (jaccard≥0.5) to the group's first member. Merged members map to a
  // single canonical key (the template); non-merged keys keep their own key.
  const observedKeys = [...landingsByKey.keys()];
  const firstFace = (k: string): Face => faceOf(landingsByKey.get(k)![0]);
  const canonical = new Map<string, string>();         // member key → canonical (template) key
  const templateForKey = new Map<string, string>();    // canonical key → its template string
  for (const g of proposeTemplates(observedKeys)) {
    const members = g.keys.filter((k) => landingsByKey.has(k) && !canonical.has(k));
    if (members.length < 2) continue;
    const anchor = firstFace(members[0]);
    const merged = members.filter((k) => jaccard(firstFace(k), anchor) >= 0.5);
    if (merged.length < 2) continue;                   // dispose: not structurally one page
    for (const m of merged) { canonical.set(m, g.template); templateForKey.set(g.template, g.template); }
  }
  const canonKey = (k: string): string => canonical.get(k) ?? k;

  // fold each observed key's landings/url into its canonical key.
  const byCanon = new Map<string, { landings: SnapNode[][]; url: string; template: string | null }>();
  for (const k of observedKeys) {
    const ck = canonKey(k);
    const entry = byCanon.get(ck) ?? { landings: [], url: urlByKey.get(k)!, template: templateForKey.get(ck) ?? null };
    entry.landings.push(...landingsByKey.get(k)!);
    byCanon.set(ck, entry);
  }

  // ── 4+5+6. per canonical key → PageInfo(s): SPA split, core, naming ──
  const pages: PageInfo[] = [];
  const splitNeedsFix: { label: string; url: string; reason: string }[] = [];
  const mergeNodes = (into: SnapNode[], add: SnapNode[]) => {
    const seen = new Set(into.map((n) => `${n.role}:${n.name}`));
    for (const n of add) { const t = `${n.role}:${n.name}`; if (!seen.has(t)) { seen.add(t); into.push(n); } }
  };
  const makePage = (k: string, url: string, template: string | null, landings: SnapNode[][], labelBase: string): PageInfo => {
    const faces = landings.map(faceOf);
    // rule 5: durable face = templateCore(faces) minus shell. Shell subtraction is Task 8 — seam:
    // subtract an empty set for now (templateCore already collapses multi-landing variance).
    const { tokens, provisional } = templateCore(faces);
    const shell: Face = new Set();                     // ponytail: Task 8 fills this via extractShell
    const core: Face = new Set([...tokens].filter((t) => !shell.has(t)));
    const nodes: SnapNode[] = [];
    for (const l of landings) mergeNodes(nodes, l);    // union → full repertoire for affordances
    const coreNodes = landings[0].filter((n) => n.name && n.name.trim() && core.has(`${n.role}:${n.name}`));
    return { key: k, url, template, label: labelBase, landings, faces, core, coreNodes, provisional, nodes, fpNodes: landings[0] };
  };
  for (const [k, { landings, url, template }] of byCanon) {
    const labelBase = labelFromKey(template ?? k);
    // rule 4: SPA split — single-link cluster the landing faces at jaccard≥0.5.
    const clusters = clusterFaces(landings.map(faceOf), 0.5);
    if (clusters.length <= 1) { pages.push(makePage(k, url, template, landings, labelBase)); continue; }
    // >1 cluster at one key → split states, each named by a heading UNIQUE to its cluster.
    const clusterCores = clusters.map((idxs) => templateCore(idxs.map((i) => faceOf(landings[i]))).tokens);
    clusters.forEach((idxs, ci) => {
      const others = clusterCores.filter((_, j) => j !== ci);
      const distinct = distinguishingHeading(clusterCores[ci], others);
      const clusterLandings = idxs.map((i) => landings[i]);
      if (!distinct) { splitNeedsFix.push({ label: labelBase, url, reason: 'same-url state with no distinguishing heading' }); return; }
      pages.push(makePage(k, url, template, clusterLandings, `${labelBase}-${slug(distinct)}`));
    });
  }

  // ── 6b. NAME collisions: append a distinguishing core heading; still colliding → both needsFix ──
  const nameNeedsFix = new Map<PageInfo, string>();
  const byLabelGroups = new Map<string, PageInfo[]>();
  for (const p of pages) (byLabelGroups.get(p.label) ?? byLabelGroups.set(p.label, []).get(p.label)!).push(p);
  for (const [, group] of byLabelGroups) {
    if (group.length < 2) continue;
    for (const p of group) {
      const distinct = distinguishingHeading(p.core, group.filter((q) => q !== p).map((q) => q.core));
      if (distinct) p.label = `${p.label}-${slug(distinct)}`;
    }
    // re-check: any still-duplicate label → all its members go to needsFix (name collision unresolved).
    const still = new Map<string, PageInfo[]>();
    for (const p of group) (still.get(p.label) ?? still.set(p.label, []).get(p.label)!).push(p);
    for (const [, dupes] of still) if (dupes.length > 1) for (const p of dupes) nameNeedsFix.set(p, 'name collision unresolved');
  }

  const pageList = pages.filter((p) => !nameNeedsFix.has(p));
  // effect → its TO page (primary page for the settled key). SPA-split attribution is Task 9's
  // job; affordance synthesis targets the FIRST page for a key (the common non-split case).
  const pageForKey = new Map<string, PageInfo>();
  for (const p of pageList) if (!pageForKey.has(p.key)) pageForKey.set(p.key, p);
  const pageKeyForEffectLanding = new Map<number, string>();
  effects.forEach((e, i) => { if (e.navigated && e.toSnapshot && ready(e.toSnapshot)) pageKeyForEffectLanding.set(i, key(e.toUrl)); });
  const labelOf = (k: string | null) => (k ? pageForKey.get(k)?.label ?? null : null);
  const fromPageKey = (url: string) => key(url);

  // ── 2. partition GOOD vs DEGENERATE, then fingerprint the good set against ITSELF ──
  // A degenerate landing (404/error, or no distinctive content) is held OUT of `states` and
  // out of the fingerprint exclusivity computation — otherwise its all-chrome fingerprint
  // makes every real page read 'ambiguous'. It's reported in `needsFix` for the agent (#5a).
  const degenerate = new Map<number, string>();   // page index → reason
  // pass A: error pages are degenerate up front (regardless of fingerprint).
  pageList.forEach((p, i) => { if (isErrorLanding(p.fpNodes)) degenerate.set(i, `error page (heading matches not-found/error)`); });

  // A page's fingerprint = the MINIMAL prefix of its candidate tokens that no OTHER GOOD page's
  // LANDING view (fpNodes) fully satisfies. Purely PAIRWISE against fixed landing views (does
  // NOT depend on other stubs' in-progress fingerprints — that ordering bug produced 30-token
  // fingerprints). Fingerprint from the LANDING (fpNodes): it carries the distinctive heading;
  // the unioned repertoire buries it under shared sidebar chrome.
  const goodIdx = (i: number) => !degenerate.has(i);
  const stubs: State[] = pageList.map((p) => makeState({
    id: 'd:' + p.label, nodeId: 'd', semanticName: p.label, urlPattern: p.url, role: 'detail', fingerprint: [],
  }));
  for (let pi = 0; pi < pageList.length; pi++) {
    if (degenerate.has(pi)) continue;                 // error pages: no fingerprint attempt
    const cands = candidateTokens(pageList[pi].fpNodes);
    const fp: string[] = [];
    let exclusive = false;
    for (const tok of cands) {
      fp.push(tok);
      // exclusive = no OTHER GOOD page's landing satisfies EVERY token in fp so far.
      exclusive = pageList.every((q, qi) => qi === pi || !goodIdx(qi) || !fp.every((t) => hasToken(q.fpNodes, t)));
      if (exclusive) break;
    }
    // pass B: a good page that NEVER became exclusive (its content is only shared chrome — a
    // blank/empty landing) is degenerate too. Held out with a clear reason.
    if (!exclusive && cands.length) { degenerate.set(pi, `no distinctive content — only shared sidebar chrome (blank/empty or unresolved landing)`); continue; }
    if (fp.length === 0 && cands.length) fp.push(cands[0]);
    stubs[pi].fingerprint = fp;
  }

  // ── 3+4. affordances per FROM page from the recorded transitions ──
  const affById = new Map<string, DraftAffordance[]>();   // page label → its affordances
  const pushAff = (label: string, a: DraftAffordance) => {
    const list = affById.get(label) ?? []; if (!list.some((x) => x.id === a.id)) list.push(a); affById.set(label, list);
    return list;
  };
  let affSeq = 0;
  effects.forEach((e, i) => {
    if (!e.fromSnapshot) return;
    const fromLabel = labelOf(fromPageKey(e.fromUrl));
    if (!fromLabel) return;
    const fromNodes = parseSnapshot(e.fromSnapshot);
    // ── non-navigating recorded action → in-page affordance (Layer 1) ──
    if (!e.navigated && e.action) {
      // a `use type` on a textbox → an input affordance (login or any field).
      if (e.action.role === 'textbox' && e.action.name) {
        pushAff(fromLabel, { id: `inp_${slug(e.action.name)}`, label: e.action.name, kind: 'input',
          elementFp: { role: 'textbox', name: e.action.name, near: null } });
        return;
      }
      // any other click: REVEAL if it exposed new ARIA-named nodes (an overlay/menu opened),
      // else MUTATE (an in-place change — sort/filter/search). Carries the recovered elementFp.
      if (e.action.name) {
        const fp: ElementFingerprint = e.action.elementFp ?? { role: e.action.role, name: e.action.name, near: null };
        const children: DraftAffordance[] = (e.diff?.added ?? [])
          .filter((n) => n.role && n.name && REVEAL_CHILD_ROLES.has(n.role))
          .map((n) => ({ id: `aff_${affSeq++}_${slug(n.name!)}`, label: n.name!,
            kind: childKind(n.role!), elementFp: { role: n.role, name: n.name!, near: null },
            ...(COMMIT_WORDS.test(n.name!) ? { needsClassification: true } : {}) }));
        const aff: DraftAffordance = children.length
          ? { id: `aff_${affSeq++}_${slug(e.action.name)}`, label: e.action.name, kind: 'reveal', elementFp: fp, children }
          : { id: `aff_${affSeq++}_${slug(e.action.name)}`, label: e.action.name, kind: 'mutate', elementFp: fp };
        if (COMMIT_WORDS.test(e.action.name)) aff.needsClassification = true;
        pushAff(fromLabel, aff);
      }
      return;
    }
    // a navigation → a navigate affordance to the landing page.
    if (e.navigated) {
      const toLabel = labelOf(pageKeyForEffectLanding.get(i) ?? '');
      if (!toLabel) return;
      let fp: ElementFingerprint | null = e.action?.elementFp ?? null;
      // action:null (bare `use navigate`) → scan the FROM page's links for the one to toUrl.
      if (!fp) {
        const link = fromNodes.find((n) => n.role === 'link' && n.name && n.url && sameTarget(n.url, e.toUrl));
        if (link) fp = { role: 'link', name: link.name!, near: null };
      }
      const id = `aff_${affSeq++}_${toLabel}`;
      const aff: DraftAffordance = { id, label: fp?.name ?? toLabel, kind: 'navigate', to: toLabel };
      if (fp) aff.elementFp = fp;
      // a NAVIGATING commit-word ("Finish", "Place Order") must be flagged too — only the
      // mutate branch checked, so a recorded commit drafted as a plain navigate a walk
      // would auto-fire (#2). Candidate flag only; the agent classifies (#5a).
      if (fp?.name && COMMIT_WORDS.test(fp.name)) aff.needsClassification = true;
      // login: if this from-page accumulated input affordances, this navigate consumes them.
      const inputs = (affById.get(fromLabel) ?? []).filter((x) => x.kind === 'input');
      if (inputs.length) { aff.needs = inputs.map((x) => x.id); aff.acceptsInput = 'credentials'; }
      pushAff(fromLabel, aff);
    }
  });

  // ── 3b. cross-link mesh: a page's OWN declared links to OTHER known pages become navigate
  // affordances too — NOT just the links that were clicked. One forward walk-through captures
  // every module's landing snapshot, which carries the full sidebar (Dashboard/other modules);
  // synthesizing those edges means modules aren't dead-ends and the agent never hand-authors
  // (error-prone) back-edges. Each is a {role:link,name} fp the resolver handles; skip a link
  // if an edge to that target already exists, or if it points at the page's own url.
  for (const p of pageList) {
    const byUrl = (url: string) => pageList.find((q) => sameTarget(q.url, url) || q.url === url);
    for (const n of p.nodes) {
      if (n.role !== 'link' || !n.name || !n.url) continue;
      const target = byUrl(n.url);
      if (!target || target.label === p.label) continue;          // unknown target / self
      const have = affById.get(p.label) ?? [];
      if (have.some((a) => a.to === target.label)) continue;       // already have this edge
      pushAff(p.label, { id: `aff_${affSeq++}_${target.label}`, label: n.name, kind: 'navigate',
        to: target.label, elementFp: { role: 'link', name: n.name, near: null } });
    }
  }

  // ── 3c. interior-synthesis (Layer 1): a page's OWN declared interactive elements become
  // input/mutate affordances even when never clicked — same philosophy as the cross-link mesh
  // (declared-but-unclicked structure is real). STRICT ARIA: a fillable role → input, any other
  // named button → mutate. NO layout/proximity inference (#5a-bounded). Skip elements already
  // captured (by a recorded action or as a navigate link), and links (the mesh owns those).
  // VERIFY-BEFORE-EMIT: only synthesize if the {role,name} fingerprint resolves UNIQUELY on this
  // page (resolveByFingerprint != null). This is the mechanical filter that drops the noise a real
  // page is full of — the 11 identical icon-glyph row buttons (ambiguous → null), a textbox named
  // by its placeholder that won't match (no match → null) — WITHOUT any judgment about meaning.
  // A genuinely unique, addressable control (one "Add", a "Search" button) survives.
  for (const p of pageList) {
    for (const n of p.nodes) {
      if (!n.name || !n.name.trim()) continue;
      if (n.role === 'link' || n.role === 'heading') continue;     // links → mesh; headings → fingerprint
      if (!INPUT_ROLES.has(n.role) && n.role !== 'button') continue; // only declared interactive controls
      const have = affById.get(p.label) ?? [];
      if (have.some((a) => a.label === n.name && (a.kind === 'input' || a.kind === 'mutate' || a.kind === 'reveal'))) continue;
      const fp: ElementFingerprint = { role: n.role, name: n.name, near: null };
      if (resolveByFingerprint(fp, p.nodes) === null) continue;    // not a reliable coordinate → skip (no guess)
      const aff: DraftAffordance = { id: `aff_${affSeq++}_${slug(n.name)}`, label: n.name, kind: childKind(n.role), elementFp: fp };
      if (COMMIT_WORDS.test(n.name)) aff.needsClassification = true;
      pushAff(p.label, aff);
    }
  }

  // ── assemble GOOD draft states only (degenerate ones go to needsFix, below) ──
  // Labels of degenerate pages, so navigate affordances pointing AT them are dropped (a good
  // state must not carry a dead edge to a held-out page).
  const degenLabels = new Set([...degenerate.keys()].map((i) => pageList[i].label));
  const states: DraftState[] = [];
  pageList.forEach((p, pi) => {
    if (degenerate.has(pi)) return;                    // held out → needsFix
    const shadow = extractShadow(p.nodes);
    const hasShadow = (shadow.collections?.length || shadow.filters?.length || shadow.createsEntity || shadow.subTabs?.length);
    const affordances = (affById.get(p.label) ?? []).filter((a) => !(a.kind === 'navigate' && a.to && degenLabels.has(a.to)));
    states.push({
      label: p.label, urlPattern: p.url, fingerprint: stubs[pi].fingerprint, affordances,
      ...(hasShadow ? { declaredShadow: shadow } : {}),
      ...(p.provisional ? { provisional: p.provisional } : {}),
    });
  });

  // ── 5. self-verify the GOOD states: flag any non-unique fingerprint / unresolvable affordance ──
  // (matchState against the good stubs only — degenerate stubs have empty fingerprints and are
  //  excluded from `states`, so they can't cause a spurious ambiguous here.)
  const goodStubs = pageList.map((p, pi) => stubs[pi]).filter((_, pi) => !degenerate.has(pi));
  for (const st of states) {
    const pi = pageList.findIndex((p) => p.label === st.label);
    const m = matchState(pageList[pi].fpNodes, goodStubs);
    if (!(m.status === 'matched' && m.state.id === stubs[pi].id)) {
      st._warning = `fingerprint not unique (matchState: ${m.status}) — curate`;
    }
    for (const a of st.affordances) {
      if (a.elementFp && (a.kind === 'navigate' || a.kind === 'mutate' || a.kind === 'input' || a.kind === 'reveal')) {
        if (resolveByFingerprint(a.elementFp, pageList[pi].nodes) === null) {
          st._warning = (st._warning ? st._warning + '; ' : '') + `affordance "${a.label}" won't resolve on this page`;
        }
      }
    }
  }

  // ── HIERARCHY (role + parentState), from the OBSERVED nav structure ──
  // A website is a tree: a hub → sections (reachable from the shared sidebar) → detail pages
  // (drilled INTO from a section). We tell them apart WITHOUT URL/frequency guessing: a link
  // present on MOST pages is the shared SIDEBAR (global nav); a link present on only 1-2 pages is
  // CONTENT (a drill-down). So:
  //   • sidebar-target  → a SECTION (top-level, no parent).
  //   • reached only via a content link → a DETAIL, parent = the page that content link is ON.
  // (Verified live: sidebar links show on most pages; a single content drill-down link on 1 — clean split.)
  const stateLabels = new Set(states.map((s) => s.label));
  // per-page LINK LABELS present (from each page's unioned snapshot nodes)
  const linkPageCount = new Map<string, Set<string>>();   // link label → pages it appears on
  for (const p of pageList) {
    if (!stateLabels.has(p.label)) continue;
    for (const n of p.nodes) if (n.role === 'link' && n.name) (linkPageCount.get(n.name) ?? linkPageCount.set(n.name, new Set()).get(n.name)!).add(p.label);
  }
  const nPages = states.length;
  const sidebarCut = Math.max(3, Math.ceil(nPages * 0.6));
  const isSidebarLink = (label: string) => (linkPageCount.get(label)?.size ?? 0) >= sidebarCut || /\b(logo|home)\b/i.test(label);
  // For each state, find a CONTENT (non-sidebar) navigate edge that lands on it → that's its parent.
  const parentOf = new Map<string, string>();
  for (const s of states) {
    for (const a of s.affordances) {
      if (a.kind === 'navigate' && a.to && stateLabels.has(a.to) && a.to !== s.label && !isSidebarLink(a.label)) {
        if (!parentOf.has(a.to)) parentOf.set(a.to, s.label);   // first content drill-in wins
      }
    }
  }
  for (const s of states) {
    const parent = parentOf.get(s.label) ?? null;
    s.parentState = parent;
    s.role = parent ? 'detail' : 'section';   // has a content parent → detail; else a top-level section
  }

  // needsFix (the agent's "your move"): held-out degenerate landings + identity failures — an
  // SPA cluster with no distinguishing heading (rule 4), a name collision that stayed unresolved
  // (rule 6). Each carries its reason.
  const needsFix: DegenerateState[] = [
    ...[...degenerate.entries()].map(([i, reason]) => ({
      label: pageList[i].label, urlPattern: pageList[i].url, reason, affordances: (affById.get(pageList[i].label) ?? []).length,
    })),
    ...splitNeedsFix.map((s) => ({ label: s.label, urlPattern: s.url, reason: s.reason, affordances: 0 })),
    ...[...nameNeedsFix.entries()].map(([p, reason]) => ({ label: p.label, urlPattern: p.url, reason, affordances: 0 })),
  ];
  // requests: provisional states (seen once) surfaced as a record-next ask (rule 2 + core).
  const requests = states.filter((s) => s.provisional).map((s) => `${s.label}: ${s.provisional}`);

  const entry = states.length ? states[0].label : null;
  const node = host(pageList[0]?.url ?? '') ? { capabilities: [], topics: [] } : undefined;
  return {
    node, states, edges: [],
    ...(needsFix.length ? { needsFix } : {}),
    receipt: {
      entry,
      states: states.map((s) => s.label),
      walkExample: entry && states.length > 1
        ? `webnav walk --start ${host(pageList[0].url)}:${entry} --goal ${host(pageList[0].url)}:${states[states.length - 1].label} --headless`
        : null,
      requests,
    },
  };
}

/** Do two hrefs point at the same target? Exact, or same pathname (ignoring origin/hash). */
function sameTarget(a: string, b: string): boolean {
  if (a === b) return true;
  try { const ua = new URL(a, 'http://x'); const ub = new URL(b, 'http://x'); return ua.pathname === ub.pathname && ua.pathname !== '/'; }
  catch { return false; }
}
