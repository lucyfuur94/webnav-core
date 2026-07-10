import type { StoredActionEffect } from '../mapstore/record.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { matchState, hasToken } from './fingerprint.js';
import { resolveByFingerprint, type ElementFingerprint } from '../playwright/fingerprint.js';
import { makeState, type State, type DeclaredShadow } from '../mapstore/types.js';
import { extractShadow } from './shadow.js';

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
  receipt: { entry: string | null; states: string[]; walkExample: string | null };
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
// not `16116-bd5a1a4a…` (the raw record id). Uses the last 1-2 non-account segments.
function pathSlug(url: string): string {
  const p = stablePathKey(url).split('/').filter(Boolean);
  // drop a leading version + numeric-account prefix (v3, 1041) for a clean label
  const meaningful = p.filter((s) => !/^v\d+$/i.test(s) && !/^\d+$/.test(s));
  return slug(meaningful.slice(-2).join('-') || meaningful.slice(-1).join('-') || 'home');
}
function host(url: string): string | null { try { return new URL(url).host; } catch { return null; } }

// STABLE page identity — the key that makes one logical page ONE state regardless of what's
// currently shown on it. A page is identified by its URL PATHNAME with the volatile parts
// removed: (a) query string + hash (a `?currentTab=`/sort/filter is an in-page mutate, not a
// new page), and (b) trailing ID-ish path segments (`/report/16116/<hash>` and its Flat/Nested
// viz variants, `/dashboard/1210` — the collection is the page; the specific record/sub-view is
// state ON it). Generic: any run of trailing segments that look like ids (digits, hashes, uuids)
// collapses to the collection path. NOT site-specific. Two DIFFERENT records of the same
// collection therefore share one state coordinate (correct per the affordance model — same
// page-type, reached by the same route; the record id is a runtime input, not map structure).
const ID_SEG = /^(\d+|[0-9a-f]{16,}|[0-9a-f-]{20,})$/i;   // numeric id, long hex hash, or uuid-ish
export function stablePathKey(url: string): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { return url; }
  const segs = path.split('/').filter(Boolean);
  // drop trailing id-ish segments so /report/16116/<hash> → /report, /dashboard/1210 → /dashboard.
  // keep a trailing NON-id segment (…/report/list stays; …/report/draft stays).
  while (segs.length && ID_SEG.test(segs[segs.length - 1])) segs.pop();
  return '/' + segs.join('/');
}

// nodes = UNION of every visit's snapshot (full repertoire, for interior-synthesis/shadow).
// fpNodes = ONE representative LANDING snapshot (stable + distinctive, for the fingerprint) —
// unioning snapshots for the fingerprint diluted the distinctive heading and left every page
// sharing the sidebar chrome → huge ambiguous fingerprints. Keep them separate.
interface PageInfo { url: string; nodes: SnapNode[]; fpNodes: SnapNode[]; slug: string; label: string; }

/**
 * Build a draft graph from recorded action-effects. Steps:
 *  1. distinct LANDING pages keyed by (toUrl + landing fingerprint) — SPA tabs at one url split.
 *  2. per page: a UNIQUENESS-driven fingerprint (greedy minimal token set that makes matchState
 *     resolve this page uniquely vs all others) + absolute urlPattern.
 *  3. per recorded transition: a navigate affordance on the FROM state carrying the captured
 *     elementFp; when the action was a bare `use navigate` (action:null), reconstruct it by
 *     scanning the FROM page's links for the one whose url matches the toUrl → {role:link,name}.
 *  4. login: `use type` actions become input affordances; the following navigate gets
 *     needs:[them] + acceptsInput:'credentials'.
 *  5. self-verify: matchState each page's own snapshot against the set, resolveByFingerprint
 *     each edge — flag failures with _warning so the agent curates BEFORE walking.
 */
export function draftFromEffects(effects: StoredActionEffect[]): DraftGraph {
  // ── 1. distinct LOGICAL pages, keyed by STABLE PATHNAME (query/hash + trailing ids
  // stripped). One page = one state even as its tabs/search/sort mutate the snapshot, and
  // effects from DIFFERENT recording sessions that touched the same page land in the same
  // state automatically (that IS the multi-session merge — a consequence of stable keying,
  // not separate merge logic). We UNION each page's snapshot nodes across every visit so the
  // fingerprint + interior-synthesis see the full repertoire the page ever showed. ──
  const pages = new Map<string, PageInfo>();           // stable key → page (nodes = union)
  // union nodes by role:name (dedup), preferring the FIRST seen (landing) order.
  const mergeNodes = (into: SnapNode[], add: SnapNode[]) => {
    const seen = new Set(into.map((n) => `${n.role}:${n.name}`));
    for (const n of add) { const k = `${n.role}:${n.name}`; if (!seen.has(k)) { seen.add(k); into.push(n); } }
  };
  const fpLanded = new Set<string>();   // keys whose fpNodes came from a real LANDING snapshot
  const pageKeyForEffectLanding = new Map<number, string>();   // effect index → its TO page key
  // isLanding = this snapshot is a page the walk NAVIGATED TO (the clean landing view) — the
  // best fingerprint source. A from/mutation snapshot only seeds fpNodes if no landing is seen.
  const ensurePage = (url: string, snap: string, isLanding: boolean): string => {
    const key = stablePathKey(url);
    const nodes = parseSnapshot(snap);
    const existing = pages.get(key);
    if (existing) {
      mergeNodes(existing.nodes, nodes);                 // union → full repertoire
      if (isLanding && !fpLanded.has(key)) { existing.fpNodes = nodes; fpLanded.add(key); }  // upgrade fp to a landing view
      return key;
    }
    let label = pathSlug(url);
    const taken = new Set([...pages.values()].map((p) => p.label));
    if (taken.has(label)) { let i = 2; while (taken.has(`${label}-${i}`)) i++; label = `${label}-${i}`; }
    pages.set(key, { url, nodes, fpNodes: nodes, slug: label, label });
    if (isLanding) fpLanded.add(key);
    return key;
  };
  // landing of the FIRST effect's fromUrl is a page too (the entry); then every toUrl.
  effects.forEach((e, i) => {
    if (e.fromSnapshot) ensurePage(e.fromUrl, e.fromSnapshot, false);   // the page the action was taken ON
    if (e.navigated && e.toSnapshot) pageKeyForEffectLanding.set(i, ensurePage(e.toUrl, e.toSnapshot, true));
    // a SAME-PAGE mutation's AFTER snapshot shows controls the mutation revealed (a picker/
    // menu opened, a filtered result appeared) — union it into the same page so the state's
    // repertoire is the FULL page, not just its landing view. NOT a fingerprint source.
    else if (!e.navigated && e.toSnapshot) ensurePage(e.toUrl, e.toSnapshot, false);
  });
  const pageList = [...pages.values()];
  const labelOf = (key: string) => pages.get(key)?.label ?? null;
  const fromPageKey = (url: string) => stablePathKey(url);

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
  // (Verified on progneo: sidebar links show on 8/9 pages; "OS and Device Report" on 1 — clean split.)
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

  // needsFix: the held-out degenerate landings, each with its reason (the agent's "your move").
  const needsFix: DegenerateState[] = [...degenerate.entries()].map(([i, reason]) => ({
    label: pageList[i].label, urlPattern: pageList[i].url, reason, affordances: (affById.get(pageList[i].label) ?? []).length,
  }));

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
    },
  };
}

/** Do two hrefs point at the same target? Exact, or same pathname (ignoring origin/hash). */
function sameTarget(a: string, b: string): boolean {
  if (a === b) return true;
  try { const ua = new URL(a, 'http://x'); const ub = new URL(b, 'http://x'); return ua.pathname === ub.pathname && ua.pathname !== '/'; }
  catch { return false; }
}
