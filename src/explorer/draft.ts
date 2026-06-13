import type { StoredActionEffect } from '../mapstore/record.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { matchState } from './fingerprint.js';
import { resolveByFingerprint, type ElementFingerprint } from '../playwright/fingerprint.js';
import { makeState, type State } from '../mapstore/types.js';

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
const COMMIT_WORDS = /\b(delete|remove|save|submit|confirm|place\s*order|pay|apply)\b/i;
export interface DraftState {
  label: string; urlPattern: string; fingerprint: string[]; affordances: DraftAffordance[];
  _warning?: string;   // self-verify flag: non-unique fingerprint / unresolvable edge — agent curates
}
export interface DraftGraph {
  node?: { capabilities?: string[]; topics?: string[] };
  states: DraftState[]; edges: never[];
  receipt: { entry: string | null; states: string[]; walkExample: string | null };
}

// candidate fingerprint tokens for a page, most-distinctive first: headings, then
// buttons/textboxes/links with names. (role:name; the vocabulary matchState matches on.)
const TOKEN_ROLES = ['heading', 'button', 'textbox', 'link', 'checkbox', 'combobox'];
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

// map an interactive ARIA role to its in-page affordance kind (strict, no layout inference):
// fillable fields → input; everything else interactive → mutate. (link-to-known-state is handled
// by the cross-link mesh, not here.)
const INPUT_ROLES = new Set(['textbox', 'combobox', 'checkbox', 'searchbox', 'spinbutton']);
function childKind(role: string): DraftAffordance['kind'] { return INPUT_ROLES.has(role) ? 'input' : 'mutate'; }
function pathSlug(url: string): string {
  try { const p = new URL(url).pathname.split('/').filter(Boolean); return slug(p.slice(-2).join('-') || 'home'); }
  catch { return slug(url); }
}
function host(url: string): string | null { try { return new URL(url).host; } catch { return null; } }

interface PageInfo { url: string; nodes: SnapNode[]; slug: string; label: string; }

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
  // ── 1. distinct landing pages (keyed url + landing fingerprint signature) ──
  const pages = new Map<string, PageInfo>();           // key → page
  const keyOfUrlSnap = (url: string, snap: string) => {
    const nodes = parseSnapshot(snap);
    const sig = candidateTokens(nodes).slice(0, 4).join('|');   // landing signature
    return { key: `${url}\n${sig}`, nodes };
  };
  const pageKeyForEffectLanding = new Map<number, string>();   // effect index → its TO page key
  const ensurePage = (url: string, snap: string): string => {
    const { key, nodes } = keyOfUrlSnap(url, snap);
    if (!pages.has(key)) {
      let label = pathSlug(url);
      // de-dup label collisions across distinct pages (editGraph keys states by label)
      const taken = new Set([...pages.values()].map((p) => p.label));
      if (taken.has(label)) { let i = 2; while (taken.has(`${label}-${i}`)) i++; label = `${label}-${i}`; }
      pages.set(key, { url, nodes, slug: label, label });
    }
    return key;
  };
  // landing of the FIRST effect's fromUrl is a page too (the entry); then every toUrl.
  effects.forEach((e, i) => {
    if (e.fromSnapshot) ensurePage(e.fromUrl, e.fromSnapshot);   // the page the action was taken ON
    if (e.navigated && e.toSnapshot) pageKeyForEffectLanding.set(i, ensurePage(e.toUrl, e.toSnapshot));
  });
  const pageList = [...pages.values()];
  const labelOf = (key: string) => pages.get(key)?.label ?? null;
  const fromPageKey = (url: string, snap: string) => keyOfUrlSnap(url, snap).key;

  // ── 2. uniqueness-driven fingerprint per page (greedy minimal token set) ──
  // Build State stubs we can feed to matchState while growing each fingerprint.
  const stubs: State[] = pageList.map((p) => makeState({
    id: 'd:' + p.label, nodeId: 'd', semanticName: p.label, urlPattern: p.url, role: 'detail', fingerprint: [],
  }));
  for (let pi = 0; pi < pageList.length; pi++) {
    const cands = candidateTokens(pageList[pi].nodes);
    const fp: string[] = [];
    for (const tok of cands) {
      fp.push(tok);
      stubs[pi].fingerprint = fp;
      const m = matchState(pageList[pi].nodes, stubs);    // does THIS page now resolve uniquely?
      if (m.status === 'matched' && m.state.id === stubs[pi].id) break;
    }
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
    const fromLabel = labelOf(fromPageKey(e.fromUrl, e.fromSnapshot));
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

  // ── assemble draft states ──
  const states: DraftState[] = pageList.map((p, pi) => ({
    label: p.label, urlPattern: p.url, fingerprint: stubs[pi].fingerprint,
    affordances: affById.get(p.label) ?? [],
  }));

  // ── 5. self-verify: flag non-unique fingerprints + unresolvable edges ──
  for (let pi = 0; pi < states.length; pi++) {
    const m = matchState(pageList[pi].nodes, stubs);
    if (!(m.status === 'matched' && m.state.id === stubs[pi].id)) {
      states[pi]._warning = `fingerprint not unique (matchState: ${m.status}) — curate`;
    }
    for (const a of states[pi].affordances) {
      // verify each affordance's OWN opener resolves on this page (reveal CHILDREN live on the
      // post-reveal snapshot we don't keep per-state, so they're not checked here).
      if (a.elementFp && (a.kind === 'navigate' || a.kind === 'mutate' || a.kind === 'input' || a.kind === 'reveal')) {
        if (resolveByFingerprint(a.elementFp, pageList[pi].nodes) === null) {
          states[pi]._warning = (states[pi]._warning ? states[pi]._warning + '; ' : '')
            + `affordance "${a.label}" won't resolve on this page`;
        }
      }
    }
  }

  const entry = pageList.length ? pageList[0].label : null;
  const node = host(pageList[0]?.url ?? '') ? { capabilities: [], topics: [] } : undefined;
  return {
    node, states, edges: [],
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
