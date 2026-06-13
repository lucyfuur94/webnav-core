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
  id: string; label: string; kind: 'navigate' | 'input';
  to?: string; elementFp?: ElementFingerprint; acceptsInput?: string; needs?: string[]; core?: boolean;
}
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
    // login input: a `use type` on a textbox → an input affordance on this page.
    if (!e.navigated && e.action && e.action.role === 'textbox' && e.action.name) {
      pushAff(fromLabel, { id: `inp_${slug(e.action.name)}`, label: e.action.name, kind: 'input',
        elementFp: { role: 'textbox', name: e.action.name, near: null } });
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
      if (a.kind === 'navigate' && a.elementFp) {
        if (resolveByFingerprint(a.elementFp, pageList[pi].nodes) === null) {
          states[pi]._warning = (states[pi]._warning ? states[pi]._warning + '; ' : '')
            + `edge "${a.label}" won't resolve on this page`;
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
