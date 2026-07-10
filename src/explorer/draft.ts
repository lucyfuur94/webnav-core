import type { StoredActionEffect } from '../mapstore/record.js';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { matchState } from './fingerprint.js';
import { resolveByFingerprint, type ElementFingerprint } from '../playwright/fingerprint.js';
import { makeState, type State, type DeclaredShadow } from '../mapstore/types.js';
import { extractShadow } from './shadow.js';
import { inferUrlModel, proposeTemplates, faceOf, jaccard, containment, templateCore, extractShell, insideOverlay, foldRepeats, type Face } from './infer.js';
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
  to?: string; elementFp?: ElementFingerprint | null; acceptsInput?: string; needs?: string[]; core?: boolean;
  children?: DraftAffordance[];     // reveal: the ARIA-named affordances the overlay exposed
  needsClassification?: boolean;    // label matched a commit-word → agent classifies (commit stays false, #2/#5a)
  scope?: 'row';                    // a folded per-row repeat (≥3 "<X> Remove" chips → one Remove);
                                    // informational repertoire, elementFp:null (mutates never route, #affordance model)
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
  role?: 'hub' | 'section' | 'detail' | 'shell';  // site-tree level ('shell' = the site-wide chrome record, not a page)
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
      if (isDataLiteral(n.name)) continue;   // identity must never rest on a bare date/number (#5)
      const tok = `${role}:${n.name}`;
      if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
  }
  return out;
}
// On a PARAMETERIZED page (URL template carries `{param}`), a big `heading:` is often the
// instance's TITLE (a user's name, a report's name) — durable enough to survive templateCore
// only because we saw one instance, but it is really per-instance DATA. So demote headings to
// the END of the candidate order: prefer any non-heading structural token (a tab, a button) for
// identity, and fall back to a heading only as a last resort. Non-param pages keep heading-first.
function candidateTokensFor(coreNodes: SnapNode[], isParam: boolean): string[] {
  const cands = candidateTokens(coreNodes);
  if (!isParam) return cands;
  const headings = cands.filter((t) => t.startsWith('heading:'));
  const rest = cands.filter((t) => !t.startsWith('heading:'));
  return [...rest, ...headings];
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
// Was the recorded action's target inside an overlay? A NAME alone is ambiguous when the page
// also carries a same-named node outside the overlay (a page heading "Search" shadowing the
// picker's textbox "Search" — the first-match gate read the heading and leaked the overlay
// control). So: match ROLE+NAME, and gate if ANY match is inside an overlay — the FROM snapshot
// has the overlay OPEN, so the recorded interaction most plausibly targeted the overlay instance.
// The flip side is harmless: a legit page-level twin re-emerges via interior synthesis from
// coreNodes, so preferring the overlay member never loses a real page affordance.
function clickedInOverlay(nodes: SnapNode[], action: { role: string; name: string | null }): boolean {
  if (!action.name) return false;
  return nodes.some((n, i) => n.role === action.role && n.name === action.name && insideOverlay(nodes, i));
}

// Enumerated VALUE DOMAIN among an overlay's added nodes (axis 2): ≥3 same-role SAME-DEPTH nodes
// with DISTINCT names are the overlay's choice list (a picker's dimension checkboxes) — data to
// read live at walk time, never persisted. foldRepeats generalized past the shared-trailing-word
// requirement, but scoped to REVEAL CHILDREN only: a page toolbar legitimately carries many
// distinct same-depth buttons, so interior synthesis must never apply this.
// ponytail: a revealed panel's own toolbar of ≥3 distinct buttons at one depth also folds — an
// acceptable loss (children are informational; the walk re-reads the overlay live at the pause).
function enumeratedNames(added: SnapNode[]): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const n of added) {
    if (!n.name || !n.name.trim()) continue;
    const k = `${n.role}|${n.depth}`;
    (groups.get(k) ?? groups.set(k, new Set()).get(k)!).add(n.name);
  }
  const out = new Set<string>();
  for (const names of groups.values()) if (names.size >= 3) for (const nm of names) out.add(nm);
  return out;
}
function host(url: string): string | null { try { return new URL(url).host; } catch { return null; } }

// A control whose accessible NAME is nothing but a bare data literal — a date (`09 Jul 2026`,
// `2026-07-09`) or a lone number/currency — is per-instance DATA, never durable structure (the
// value changes every day/instance; the design explicitly REFUSES to store dates). This is a
// universal content-TYPE prior (like the ERROR_HEADING phrases), NOT a site-specific token — it
// names no product, matches no app-ism. Conservative: only an ENTIRE-name match (a real control
// like "Due 09 Jul 2026" or "Delete" is untouched), so it never eats a labelled affordance.
const DATA_LITERAL =
  /^(?:\d{1,2}[ /-]\w{3,9}[ /-]\d{2,4}|\d{4}-\d{2}-\d{2}|[£$€]?\s?\d[\d,.]*%?)$/;
const isDataLiteral = (name: string): boolean => DATA_LITERAL.test(name.trim());

// A path segment that is an opaque instance id — all-digits or a long hex/uuid-ish token. The
// design's sanctioned URL-SHAPE prior (a digit/hex segment is probably a param); site-AGNOSTIC (no
// product tokens). Used to both flag param pages and keep ids out of labels; `{param}` (an already-
// abstracted template slot) counts as opaque too.
const isOpaqueSeg = (s: string): boolean => s === '{param}' || /^\d+$/.test(s) || /^[0-9a-f]{16,}$/i.test(s);
// A key whose TAIL segment is opaque is PROBABLY a parameterized instance page. Used ONLY to demote
// a heading to "probably instance data" — never as silent truth. A page that formed a real {param}
// template already reads as param; this catches the LONE opaque-id instance (e.g. `/dashboard/1210`)
// that never grouped into a template.
function looksParameterizedKey(key: string): boolean {
  const segs = key.split('/').filter(Boolean).filter((s) => s !== '{param}');
  const tail = segs[segs.length - 1];
  return !!tail && isOpaqueSeg(tail);
}

// Label from the MEANINGFUL (non-opaque, non-{param}) tail segments (≤2) of a template/key path,
// so a state reads `report-list` / `report` / `dashboard`, never a raw record id (`16116-c8c6…`).
// Opaque id segments (`16116`, a uuid, `{param}`) are dropped — they carry no human meaning and
// two instances of the same page (`/report/16116/{hash}` variants) then collide on the SAME clean
// label, so the name-collision resolver distinguishes them by a structural heading/tab. `/` → home.
function labelFromKey(key: string): string {
  const segs = key.split('/').filter(Boolean).filter((s) => s !== '{param}' && !isOpaqueSeg(s));
  return slug(segs.slice(-2).join('-') || 'home');
}
// The first DURABLE STRUCTURAL token of `core` that no `others` face carries — used to name an
// SPA split or break a label collision. A `heading:` is preferred (a view's own title reads best,
// e.g. `report-flat`); a `tab:` is the fallback (two vizzes of one report differ only by their tab
// set — `tab:Flat` distinguishes them where no heading does). Returns the bare name; null if
// nothing structural distinguishes (→ the caller sends the pair to needsFix, never a wrong merge).
function distinguishingHeading(core: Face, others: Face[]): string | null {
  for (const prefix of ['heading:', 'tab:']) {
    for (const t of core) {
      if (!t.startsWith(prefix)) continue;
      if (others.every((o) => !o.has(t))) return t.slice(prefix.length);
    }
  }
  return null;
}
// Two faces are "the same page" when jaccard ≥ 0.5 OR containment ≥ 0.9. The containment arm
// joins a PARTIAL RENDER (a subset face — the page captured before its data grid arrived) to its
// full sibling, which jaccard alone splits (live finding: 199- vs 33-token landings of ONE list
// page → jaccard 0.17, containment 1.0; the split lost the page to needsFix). A genuinely
// different page is neither jaccard-close nor contained. The containment arm requires the
// SMALLER face to carry ≥8 tokens of evidence: a near-empty chrome-only face is "contained" in
// anything by coincidence (real case: a 1-token page merged into an unrelated one under a false
// /{param} template), while a real partial render always has a rendered skeleton (observed: 10+
// non-shell tokens). 8 matches classifyReadiness's minNodes. All thresholds documented tunables.
const sameFace = (a: Face, b: Face): boolean =>
  jaccard(a, b) >= 0.5 || (Math.min(a.size, b.size) >= 8 && containment(a, b) >= 0.9);
// Single-link clustering of faces under `sameFace` (union-find). Returns clusters as index
// groups. One key with structurally-distinct landings splits into >1 cluster (SPA views at one
// URL); same-structure repeat visits — and partial renders of one page — stay in one cluster.
function clusterFaces(faces: Face[]): number[][] {
  const parent = faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    if (sameFace(faces[i], faces[j])) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));
  return [...groups.values()];
}

// A logical page: identified by its aliased URL key, defined by its SETTLED READY landings.
// - landings/faces: only navigated + classifyReadiness==='ready' snapshots feed identity
//   (Task 9 uses non-nav toSnapshots for affordances only — NOT here). landings[0] is the raw
//   entry view (error-page detection reads it).
// - core/coreNodes: the durable, data-separated face (templateCore, minus shell) + the first
//   landing filtered to core. Task 10 draws BOTH the fingerprint and the shadow from here.
// - nodes: the ONE remaining bridge field — the union of every landing (full repertoire). Only
//   the cross-link mesh + the `_shell` synthesis still read it, and both genuinely need the union:
//   a sidebar/content link's href must be recoverable even from a landing where it isn't core.
interface PageInfo {
  key: string; url: string; template: string | null; label: string;
  landings: SnapNode[][]; faces: Face[]; core: Face; coreNodes: SnapNode[]; provisional: string | null;
  nodes: SnapNode[];
  shadowNodes: SnapNode[];   // core-named + UNNAMED structural nodes (a `table` has no name but
                             // anchors its columnheaders; depth walks need the container chain) —
                             // extractShadow reads THIS, not coreNodes, else collections are
                             // silently empty on every site
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
    // per-session ENTRY landing (Task 15 review finding): the CLI concatenates sessions and each
    // session's seq restarts at 0, so a session boundary is OBSERVABLE as a seq reset (seq ≤ the
    // previous effect's; verified on the real 5-session data — strictly increasing within a
    // session, 0 at each start). A session's first effect enters ON a real page whose only
    // observation may be its fromSnapshot (a session recorded entirely on one page never
    // navigates TO it) — the old i===0-only rule dropped that page for every session but the
    // first, so all its recorded actions lost their fromLabel and were silently discarded (the
    // report-builder husk: 46 real actions dropped). Seed the entry landing at EVERY boundary,
    // through the same readiness-gated pushLanding path.
    const sessionStart = i === 0 || e.seq <= effects[i - 1].seq;
    if (sessionStart && e.fromSnapshot) pushLanding(e.fromUrl, e.fromSnapshot);
    if (e.navigated && e.toSnapshot) pushLanding(e.toUrl, e.toSnapshot);
  });

  // ── SHELL (axis 3), computed PRE-MERGE from the distinct pages' first-landing faces ──
  // The shared chrome = tokens on ≥80% of DISTINCT pages (extractShell; ≥4-page gate). One face
  // per page (its first landing), NOT per landing — else a page visited many times would drown
  // out the cross-page signal. Computed here (before template merge) on purpose: the dispose
  // check and the SPA split both compare shell-SUBTRACTED faces (design doc: structural
  // similarity runs on non-shell nodes), so single-segment chrome-heavy pages don't over-merge
  // under /{param} on their identical sidebars.
  const observedKeys = [...landingsByKey.keys()];
  const shell = extractShell(observedKeys.map((k) => faceOf(landingsByKey.get(k)![0])));
  const minusShell = (f: Face): Face => new Set([...f].filter((t) => !shell.has(t)));

  // ── 3. PROPOSE/DISPOSE templates (rule 3) ──
  // Group keys by proposeTemplates; a group MERGES only when every member's first-landing face,
  // WITH SHELL SUBTRACTED, is structurally close (jaccard≥0.5) to the group's first member. On
  // shell-subtracted faces so shared chrome can't inflate the similarity (the over-merge fix).
  // Merged members map to a single canonical key (the template); non-merged keys keep their key.
  const firstFace = (k: string): Face => minusShell(faceOf(landingsByKey.get(k)![0]));
  const canonical = new Map<string, string>();         // member key → canonical (template) key
  const templateForKey = new Map<string, string>();    // canonical key → its template string
  for (const g of proposeTemplates(observedKeys)) {
    const members = g.keys.filter((k) => landingsByKey.has(k) && !canonical.has(k));
    if (members.length < 2) continue;
    const anchor = firstFace(members[0]);
    const merged = members.filter((k) => sameFace(firstFace(k), anchor));
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
    // PARTIAL-RENDER exclusion (axis 1 settledness): a landing whose face is a (near-)strict
    // subset of a sibling's (containment ≥ 0.95, strictly smaller) was captured before the page
    // finished rendering — absence-due-to-non-render is NOT evidence of absence, so it must not
    // feed templateCore (it would intersect the core down to the sparse subset: the husk class).
    // Excluded from the CORE computation only — it stays a landing/face for identity checks. If
    // only one full landing remains, templateCore's seen-once rule marks the state provisional:
    // honest (we truly saw the full page once).
    const isPartial = (i: number) => faces.some((g, j) => j !== i && faces[i].size < g.size && containment(faces[i], g) >= 0.95);
    const coreIdx = faces.map((_, i) => i).filter((i) => !isPartial(i));
    // rule 5: durable face = templateCore(full faces) minus shell — the site chrome lives on
    // `_shell`, not on each page's core (else every state carries the whole sidebar).
    const { tokens, provisional } = templateCore(coreIdx.map((i) => faces[i]));
    const core = minusShell(tokens);
    const nodes: SnapNode[] = [];
    for (const l of landings) mergeNodes(nodes, l);    // union → full repertoire for affordances
    // coreNodes from the first FULL landing — a partial landings[0] would filter the full core
    // down to its own sparse subset of nodes.
    const coreNodes = landings[coreIdx[0]].filter((n) => n.name && n.name.trim() && core.has(`${n.role}:${n.name}`));
    // shadowNodes: the same landing keeping core-named nodes AND unnamed structural containers —
    // extractShadow anchors columns on the (nameless) `table` node and walks depths; a named-only
    // view has no containers, so its collections came out empty on every site.
    const shadowNodes = landings[coreIdx[0]].filter((n) => !n.name || !n.name.trim() || core.has(`${n.role}:${n.name}`));
    return { key: k, url, template, label: labelBase, landings, faces, core, coreNodes, provisional, nodes, shadowNodes };
  };
  for (const [k, { landings, url, template }] of byCanon) {
    const labelBase = labelFromKey(template ?? k);
    // rule 4: SPA split — single-link cluster the landing faces at jaccard≥0.5, on SHELL-
    // SUBTRACTED faces (same as dispose): the shared chrome is on every SPA view, so leaving it
    // in would falsely collapse structurally-distinct views into one cluster.
    const clusters = clusterFaces(landings.map((l) => minusShell(faceOf(l))));
    // A cluster whose landings are ALL error pages is a transient / pre-redirect capture, NOT a
    // real second state at this key (axis 1: a non-settled URL is an alias, never a state). On old
    // data with no `requestedUrl`, the pre-redirect ghost was snapshotted as its own 'ready' 404
    // (a bare `/x/list` → "Page not found", which base-inference merges into the settled tenant
    // `/1234/x/list`). Hold error clusters out as needsFix; they must NOT force an SPA split or
    // suffix the healthy sibling's name. What's left is the REAL cluster(s).
    const errorCluster = (idxs: number[]) => idxs.every((i) => isErrorLanding(landings[i]));
    const realClusters = clusters.filter((idxs) => !errorCluster(idxs));
    for (const idxs of clusters) if (errorCluster(idxs)) splitNeedsFix.push({ label: labelBase, url, reason: 'error page (heading matches not-found/error)' });
    // ≤1 REAL cluster → not an SPA split: the single page at labelBase (no suffix), landings = its
    // real cluster (or, if every cluster was an error, all landings — the whole page is degenerate,
    // partition-good-vs-degenerate below holds it out honestly).
    if (realClusters.length <= 1) {
      const keep = realClusters.length === 1 ? realClusters[0].map((i) => landings[i]) : landings;
      pages.push(makePage(k, url, template, keep, labelBase)); continue;
    }
    // ≥2 real clusters at one key → genuine SPA split, each named by a heading UNIQUE to its cluster.
    const clusterCores = realClusters.map((idxs) => templateCore(idxs.map((i) => faceOf(landings[i]))).tokens);
    realClusters.forEach((idxs, ci) => {
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
  // URL → the PAGE key: alias-resolved AND canonicalized. A page that merged into a {param}
  // template is registered under the TEMPLATE key (p.key), so every lookup from a raw URL must
  // apply canonKey too — without it, every recorded action FROM a merged member URL resolved no
  // label and was silently dropped (the report-builder husk's second cause, latent until the
  // per-session entry landings made the /report/16116/{param} merge actually happen).
  const fromPageKey = (url: string) => canonKey(key(url));
  const pageKeyForEffectLanding = new Map<number, string>();
  effects.forEach((e, i) => { if (e.navigated && e.toSnapshot && ready(e.toSnapshot)) pageKeyForEffectLanding.set(i, fromPageKey(e.toUrl)); });
  const labelOf = (k: string | null) => (k ? pageForKey.get(k)?.label ?? null : null);

  // ── 2. partition GOOD vs DEGENERATE, then fingerprint the good set against ITSELF ──
  // A degenerate landing (404/error, or no distinctive content) is held OUT of `states` and
  // out of the fingerprint exclusivity computation — otherwise its all-chrome fingerprint
  // makes every real page read 'ambiguous'. It's reported in `needsFix` for the agent (#5a).
  const degenerate = new Map<number, string>();   // page index → reason
  // pass A: error pages are degenerate up front (regardless of fingerprint). Read the raw first
  // landing (an error heading is announced on the page itself, not necessarily in the durable core).
  pageList.forEach((p, i) => { if (isErrorLanding(p.landings[0])) degenerate.set(i, `error page (heading matches not-found/error)`); });

  // A page's fingerprint = the MINIMAL prefix of its CORE candidate tokens (Task 10) that no
  // OTHER GOOD page's LANDING FACE fully satisfies. Fingerprint from the CORE, not the union or
  // a single landing: a token that VARIED across this page's landings is data (dropped by
  // templateCore) and must never anchor identity. Exclusivity is checked against every OTHER
  // page's landing faces — an fp is exclusive only when NO face of any other good page contains
  // all its tokens (so a walk can't land on a sibling and match this state too). Purely pairwise
  // (does NOT depend on other stubs' in-progress fingerprints — that ordering bug produced 30-token
  // fingerprints).
  const goodIdx = (i: number) => !degenerate.has(i);
  const stubs: State[] = pageList.map((p) => makeState({
    id: 'd:' + p.label, nodeId: 'd', semanticName: p.label, urlPattern: p.url, role: 'detail', fingerprint: [],
  }));
  for (let pi = 0; pi < pageList.length; pi++) {
    if (degenerate.has(pi)) continue;                 // error pages: no fingerprint attempt
    const p = pageList[pi];
    // param = a formed {param} template OR a lone opaque-id-tail key (the sanctioned URL-shape
    // prior) — either way the big heading is "probably instance data", handled provisionally below.
    const isParam = (!!p.template && p.template.includes('{param}')) || looksParameterizedKey(p.key);
    // A FOLDED per-row/per-chip name (axis 5: `<X> Remove` metric chips, row `Delete`s) is value-
    // bound DATA — it must never anchor identity (else `report`'s fp rests on `OS Remove`/`eCPM
    // Remove`, the specific metrics of one instance). Drop the folded names from the fp candidates.
    const { foldedNames: fpFolded } = foldRepeats(p.coreNodes);
    const fpNodes = fpFolded.size ? p.coreNodes.filter((n) => !(n.name && fpFolded.has(n.name))) : p.coreNodes;
    const cands = candidateTokensFor(fpNodes, isParam);
    // pass B (empty core): a good page whose durable core carries NO candidate token — its only
    // content is shared shell chrome (a blank/empty landing) — has no distinctive identity. Held
    // out with a clear reason (matches upstream: identity is drawn from the core, and an empty
    // core is genuinely indistinguishable from every other logged-in page).
    if (!cands.length) { degenerate.set(pi, `no distinctive content — only shared sidebar chrome (blank/empty or unresolved landing)`); continue; }
    const fp: string[] = [];
    let exclusive = false;
    for (const tok of cands) {
      fp.push(tok);
      // exclusive = NO face of any OTHER GOOD page contains EVERY token in fp so far.
      exclusive = pageList.every((q, qi) => qi === pi || !goodIdx(qi) || q.faces.every((f) => !fp.every((t) => f.has(t))));
      if (exclusive) break;
    }
    // a page that NEVER became exclusive (its core content is shared with a sibling) is degenerate.
    if (!exclusive) { degenerate.set(pi, `no distinctive content — only shared sidebar chrome (blank/empty or unresolved landing)`); continue; }
    // rule 1 (axis 4): on a {param} page whose identity rests ONLY on heading token(s), the
    // discriminator is CROSS-INSTANCE VARIANCE, split by how many instances we saw:
    //   • ≥2 instances (provisional=null): the heading REPEATED across instances → it's the
    //     page-type TITLE (structural), not per-instance data. Keep it as the fingerprint. (The
    //     `/employee/{param}` "Employee Profile" case — confirmed structural by repetition.)
    //   • 1 instance (provisional set): cannot separate the heading from data — it may be the
    //     instance's own name (a user, a report → the `heading:Testuser` failure). No durable
    //     identity YET: hold out as needsFix with the record-next ask, never a silent instance-data
    //     fingerprint. A param page with a STRUCTURAL token (tab/button) already kept it above.
    const headingOnly = fp.length && fp.every((t) => t.startsWith('heading:'));
    if (isParam && headingOnly && p.provisional) {
      degenerate.set(pi, 'identity rests only on a heading that is likely instance data — record a different {param} instance to separate structure from data');
      continue;
    }
    stubs[pi].fingerprint = fp;
    // ≥2-instance heading-only identity is structural-but-still-worth-flagging: surface the
    // record-next note (kept, not held out). Matches the pre-rewrite provisional-warning contract.
    if (isParam && headingOnly && !p.provisional) {
      const note = 'identity rests on a heading that may be instance data — record a different {param} instance';
      p.provisional = note;
    }
  }

  // ── 3+4. affordances per FROM page from the recorded transitions ──
  const affById = new Map<string, DraftAffordance[]>();   // page label → its affordances
  // One repertoire row per DISTINCT control: recorded ids are per-click (`aff_N_…`), so a
  // re-clicked control must dedup by control identity (kind+label+to), not id — else every
  // repeat click duplicates the affordance (the builder had `Remove` ×6, `Share` ×2). A
  // re-observed REVEAL may expose children an earlier click didn't → union children by label;
  // a later navigate that gained `needs` (login inputs) keeps them.
  const pushAff = (label: string, a: DraftAffordance) => {
    const list = affById.get(label) ?? []; affById.set(label, list);
    const twin = list.find((x) => x.kind === a.kind && x.label === a.label && x.to === a.to);
    if (!twin) { list.push(a); return list; }
    if (a.children?.length) {
      const have = new Set((twin.children ?? []).map((c) => c.label));
      twin.children = [...(twin.children ?? []), ...a.children.filter((c) => !have.has(c.label))];
    }
    if (a.needs && !twin.needs) { twin.needs = a.needs; twin.acceptsInput = a.acceptsInput; }
    return list;
  };
  let affSeq = 0;
  effects.forEach((e, i) => {
    if (!e.fromSnapshot) return;
    const fromLabel = labelOf(fromPageKey(e.fromUrl));
    if (!fromLabel) return;
    const fromNodes = parseSnapshot(e.fromSnapshot);
    // SHELL GATE (axis 3): a recorded action ON a shell node (a click on `Dark Mode`/`Close
    // sidebar`/`O Overview Merged Change`, a nav via `Help Center`/`Announcements`) is a SHELL
    // affordance — it lives ONCE on `_shell` (synthesized below), NOT duplicated onto whatever
    // page it happened to be clicked from. Same principle the cross-link mesh already applies to
    // shell links; without it the chrome leaks onto every page as a broken page affordance.
    if (e.action?.name && shell.has(`${e.action.role}:${e.action.name}`)) return;
    // ── non-navigating recorded action → in-page affordance (Layer 1) ──
    if (!e.navigated && e.action) {
      // OVERLAY GATE (rules 1+5): a recorded action on a node that was INSIDE an overlay on the
      // page-as-clicked (its FROM snapshot has it nested under a dialog/menu/listbox) is NOT a page
      // affordance — its structure already lives as the OPENER's `children`. Emitting it too would
      // duplicate every picked value (a chosen dimension, a typed search term) as page structure —
      // exactly the DATA-VALUE leak this task removes. Test on the FROM snapshot (the page as it
      // was when clicked), parsed above — never landings.
      if (clickedInOverlay(fromNodes, e.action)) return;
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
        // reveal children are DE-VALUED (rule 2), two folds:
        //  • foldRepeats — names sharing a trailing word (`<X> Remove` chips);
        //  • enumeratedNames — ≥3 same-role SAME-DEPTH children with distinct names are the
        //    overlay's enumerated VALUE DOMAIN (a picker's 17 dimension checkboxes: Publisher,
        //    Country, Month…) — data read LIVE at walk time, never persisted (axis 2). The
        //    overlay's own controls (Apply/Cancel/Close/Search/tabs) never repeat ≥3-distinct
        //    at one role+depth, so they survive. Safe ONLY inside an overlay — a PAGE toolbar
        //    legitimately has many distinct buttons (interior synthesis must not use this).
        const addedNodes = e.diff?.added ?? [];
        const { foldedNames } = foldRepeats(addedNodes);
        const valueDomain = enumeratedNames(addedNodes);
        const children: DraftAffordance[] = addedNodes
          .filter((n) => n.role && n.name && REVEAL_CHILD_ROLES.has(n.role) && !foldedNames.has(n.name) && !valueDomain.has(n.name))
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
  // (error-prone) back-edges. Each is a {role:link,name} fp the resolver handles.
  // Match a link's href through key() — base-strip + ALIAS — NOT raw sameTarget: a sidebar link
  // often points at the PRE-REDIRECT ghost url (`/auth/login`) while the page actually SETTLED at
  // the aliased key (`/dashboard/index`). sameTarget on the raw href would find no page and drop
  // the edge (the redirect-mismatch mesh gap). Links live on landing nodes (`p.nodes` = union of the
  // page's ready landings — mutation-after snapshots are never landings, so never here).
  // SKIP shell links: a `link:X` in the shell is a from-anywhere edge that lives on `_shell`, not
  // duplicated onto every page state.
  const labelByKey = new Map<string, string>();   // canonical page key → its label (alias-resolved)
  for (const p of pageList) if (!labelByKey.has(p.key)) labelByKey.set(p.key, p.label);
  for (const p of pageList) {
    for (const n of p.nodes) {
      if (n.role !== 'link' || !n.name || !n.url) continue;
      if (shell.has(`link:${n.name}`)) continue;                   // shell link → lives on _shell
      const targetLabel = labelByKey.get(fromPageKey(n.url));      // alias- AND canonical-aware
      if (!targetLabel || targetLabel === p.label) continue;       // unknown target / self
      const have = affById.get(p.label) ?? [];
      if (have.some((a) => a.to === targetLabel)) continue;        // already have this edge
      pushAff(p.label, { id: `aff_${affSeq++}_${targetLabel}`, label: n.name, kind: 'navigate',
        to: targetLabel, elementFp: { role: 'link', name: n.name, near: null } });
    }
  }

  // ── 3c. interior-synthesis (Layer 1): a page's OWN declared interactive elements become
  // input/mutate affordances even when never clicked — same philosophy as the cross-link mesh
  // (declared-but-unclicked structure is real). STRICT ARIA: a fillable role → input, any other
  // named button → mutate. NO layout/proximity inference (#5a-bounded). Skip elements already
  // captured (by a recorded action or as a navigate link), and links (the mesh owns those).
  // Reads the page's CORE nodes only (Task 9), NOT the union of every landing — a value that
  // appeared in one visit but is not in the durable core (a per-row datum, a one-off chip) must
  // never synthesize as structure (the union leaked exactly these). resolveByFingerprint is still
  // checked against the same coreNodes so an ambiguous control (11 identical icon glyphs) is dropped.
  // FOLD FIRST (rule 4): ≥3 same-role/depth core nodes sharing a trailing word are one row-scoped
  // repeat — emit ONE informational scope:'row' affordance (label = the shared suffix, elementFp
  // null: mutates never route, so no resolution is needed) and skip the folded names below.
  for (const p of pageList) {
    const { folds, foldedNames } = foldRepeats(p.coreNodes);
    for (const fold of folds) {
      const aff: DraftAffordance = { id: `aff_${affSeq++}_${slug(fold.suffix)}`, label: fold.suffix,
        kind: childKind(fold.role), scope: 'row', elementFp: null };
      if (COMMIT_WORDS.test(fold.suffix)) aff.needsClassification = true;   // "Remove"/"Delete" → agent classifies (#2/#5a)
      pushAff(p.label, aff);
    }
    for (const n of p.coreNodes) {
      if (!n.name || !n.name.trim()) continue;
      if (foldedNames.has(n.name)) continue;                       // a folded per-row value → not its own affordance
      if (n.role === 'link' || n.role === 'heading') continue;     // links → mesh; headings → fingerprint
      if (!INPUT_ROLES.has(n.role) && n.role !== 'button') continue; // only declared interactive controls
      const have = affById.get(p.label) ?? [];
      if (have.some((a) => a.label === n.name && (a.kind === 'input' || a.kind === 'mutate' || a.kind === 'reveal'))) continue;
      const fp: ElementFingerprint = { role: n.role, name: n.name, near: null };
      if (resolveByFingerprint(fp, p.coreNodes) === null) continue;  // not a reliable coordinate → skip (no guess)
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
    const shadow = extractShadow(p.shadowNodes);   // rule 2: durable core + structural containers, not the union
    // extractShadow no longer emits subTabs (site-specific container lookup deleted, rule 2), so
    // the check drops it — a freshly-extracted shadow only carries collections/filters/createsEntity.
    const hasShadow = (shadow.collections?.length || shadow.filters?.length || shadow.createsEntity);
    const affordances = (affById.get(p.label) ?? [])
      // drop a navigate to a held-out (degenerate) page — no dead edges.
      .filter((a) => !(a.kind === 'navigate' && a.to && degenLabels.has(a.to)))
      // UNRESOLVABLE-COORDINATE GATE (#3: store only DURABLE fingerprints): an INTERIOR affordance
      // (mutate/input) whose recovered elementFp has NO usable name is not a reliable coordinate —
      // a walk can't deterministically re-find `combobox` (no name) among many, and in practice
      // these are the personalized chart widgets the recorder couldn't pin (a dashboard's `Country`
      // dimension, `Bar Chart Vz`, `Toggle Right Panel` — all null-name fps = per-instance data).
      // Exempt: navigate (target in union/shell, verified separately), row folds (elementFp:null by
      // design), and a REVEAL that exposed named children (its opener may be unnamed but the overlay
      // it opened IS real declared structure).
      .filter((a) => a.kind === 'navigate' || a.scope === 'row' || !a.elementFp
        || (a.kind === 'reveal' && !!a.children?.length)
        || (!!a.elementFp.name && a.elementFp.name.trim() !== ''))
      // DATA-LITERAL GATE: a control named purely by a date/number is instance data (#5 refuses
      // dates), even when it resolves — refuse it as a stored affordance (its reveal children too).
      .filter((a) => !isDataLiteral(a.label))
      .map((a) => (a.children ? { ...a, children: a.children.filter((c) => !isDataLiteral(c.label)) } : a));
    states.push({
      label: p.label, urlPattern: p.url, fingerprint: stubs[pi].fingerprint, affordances,
      ...(hasShadow ? { declaredShadow: shadow } : {}),
      ...(p.provisional ? { provisional: p.provisional } : {}),
    });
  });

  // ── 5. self-verify the GOOD states: flag any non-unique fingerprint / unresolvable affordance ──
  // (matchState against the good stubs only — degenerate stubs have empty fingerprints and are
  //  excluded from `states`, so they can't cause a spurious ambiguous here.)
  // Verify against the page's CORE nodes (Task 10) — the same view synthesis draws affordances
  // and fingerprints from. Verifying the fp against a UNION landing that also carried a transient
  // twin, or an affordance against the union while it was synthesized from core, produced spurious
  // _warnings (a prior reviewer flagged the union/core mismatch); coreNodes makes them consistent.
  const goodStubs = pageList.map((p, pi) => stubs[pi]).filter((_, pi) => !degenerate.has(pi));
  for (const st of states) {
    const pi = pageList.findIndex((p) => p.label === st.label);
    const m = matchState(pageList[pi].coreNodes, goodStubs);
    if (!(m.status === 'matched' && m.state.id === stubs[pi].id)) {
      st._warning = `fingerprint not unique (matchState: ${m.status}) — curate`;
    }
    for (const a of st.affordances) {
      if (!a.elementFp) continue;
      // Resolve against the SAME node set the affordance was synthesized from (consistency with
      // synthesis — the prior union/core mismatch produced spurious _warnings): interior
      // input/mutate/reveal come from the CORE (and are already gated on resolving there), so verify
      // on coreNodes; a NAVIGATE's link lives in the full landing/shell (subtracted from core), so
      // verify it against the union `nodes`.
      const against = a.kind === 'navigate' ? pageList[pi].nodes : pageList[pi].coreNodes;
      if (resolveByFingerprint(a.elementFp, against) === null) {
        st._warning = (st._warning ? st._warning + '; ' : '') + `affordance "${a.label}" won't resolve on this page`;
      }
    }
  }

  // ── HIERARCHY (role + parentState), from the OBSERVED nav structure ──
  // A website is a tree: sections (reachable from the shared shell/sidebar) → detail pages
  // (drilled INTO from a section). We tell them apart WITHOUT URL/frequency guessing: a SHELL
  // link is global nav; any other (content) link is a drill-down. So:
  //   • shell-linked page   → a SECTION (top-level, no parent).
  //   • reached only via a content link → a DETAIL, parent = the page that content link is ON.
  // isSidebarLink now reads the SHELL directly (a link:X on the site chrome) rather than re-
  // counting ≥60%-of-pages presence — same signal, one source of truth. `logo`/`home` stay a
  // hard-coded chrome heuristic (they're global nav even when a small site's shell didn't fire).
  const stateLabels = new Set(states.map((s) => s.label));
  const isSidebarLink = (label: string) => shell.has(`link:${label}`) || /\b(logo|home)\b/i.test(label);
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
  // pageStates: the real pages (hierarchy + receipt + walk example see ONLY these). `_shell` is a
  // site-level record, not a page — appended to `states` below but never a hierarchy node / entry.
  const pageStates = [...states];

  // ── SHELL STATE (axis 3, rule 2): the shared chrome, stored ONCE. Emitted only when shell is
  // non-empty (the ≥4-page gate already guards this). Its affordances = the shell's declared
  // interactive tokens: a shell `link:X` whose observed href keys (alias-aware) to a known page →
  // a navigate to that page (a from-anywhere edge); shell buttons/inputs → mutate/input by role.
  // We look up a representative SnapNode per shell token from the page landings to recover the
  // link href (for alias resolution) and preserve the exact role.
  if (shell.size) {
    const repNode = new Map<string, SnapNode>();   // shell token → a representative node (for url/role)
    for (const p of pageList) for (const n of p.nodes) {
      if (!n.name) continue;
      const tok = `${n.role}:${n.name}`;
      if (shell.has(tok) && !repNode.has(tok)) repNode.set(tok, n);
    }
    const shellAff: DraftAffordance[] = [];
    const goodLabels = new Set(pageStates.map((s) => s.label));
    for (const tok of shell) {
      const n = repNode.get(tok);
      if (!n || !n.name) continue;
      if (n.role === 'link') {
        // navigate only if the href resolves (alias-aware) to a GOOD page state.
        const targetLabel = n.url ? labelByKey.get(fromPageKey(n.url)) : undefined;
        if (!targetLabel || !goodLabels.has(targetLabel)) continue;   // dead/unknown shell link → drop
        shellAff.push({ id: `sh_${affSeq++}_${targetLabel}`, label: n.name, kind: 'navigate',
          to: targetLabel, elementFp: { role: 'link', name: n.name, near: null } });
      } else if (INPUT_ROLES.has(n.role) || n.role === 'button') {
        const aff: DraftAffordance = { id: `sh_${affSeq++}_${slug(n.name)}`, label: n.name,
          kind: childKind(n.role), elementFp: { role: n.role, name: n.name, near: null } };
        if (COMMIT_WORDS.test(n.name)) aff.needsClassification = true;   // flag, agent classifies (#2/#5a)
        shellAff.push(aff);
      }
    }
    const firstUrl = pageStates[0]?.urlPattern ?? '';
    const originOf = (u: string): string => { try { return new URL(u).origin; } catch { return u; } };
    states.push({ label: '_shell', role: 'shell', urlPattern: originOf(firstUrl), fingerprint: [], affordances: shellAff });
  }

  // needsFix (the agent's "your move"): held-out degenerate landings + identity failures — an
  // SPA cluster with no distinguishing heading (rule 4), a name collision that stayed unresolved
  // (rule 6). Each carries its reason. Unique by (label, reason): several lost clusters of ONE
  // key are one problem, not one row per cluster.
  const nfSeen = new Set<string>();
  const needsFix: DegenerateState[] = [
    ...[...degenerate.entries()].map(([i, reason]) => ({
      label: pageList[i].label, urlPattern: pageList[i].url, reason, affordances: (affById.get(pageList[i].label) ?? []).length,
    })),
    ...splitNeedsFix.map((s) => ({ label: s.label, urlPattern: s.url, reason: s.reason, affordances: 0 })),
    ...[...nameNeedsFix.entries()].map(([p, reason]) => ({ label: p.label, urlPattern: p.url, reason, affordances: 0 })),
  ].filter((n) => { const k = `${n.label}|${n.reason}`; if (nfSeen.has(k)) return false; nfSeen.add(k); return true; });
  // requests: provisional states (seen once) surfaced as a record-next ask (rule 2 + core).
  // `_shell` is never provisional (no `provisional` field) so it's naturally excluded.
  const requests = pageStates.filter((s) => s.provisional).map((s) => `${s.label}: ${s.provisional}`);

  // entry / walkExample / receipt.states see ONLY page states — `_shell` is site chrome, not a
  // navigable page in the tree.
  const entry = pageStates.length ? pageStates[0].label : null;
  const node = host(pageList[0]?.url ?? '') ? { capabilities: [], topics: [] } : undefined;
  return {
    node, states, edges: [],
    ...(needsFix.length ? { needsFix } : {}),
    receipt: {
      entry,
      states: pageStates.map((s) => s.label),
      walkExample: entry && pageStates.length > 1
        ? `webnav walk --start ${host(pageList[0].url)}:${entry} --goal ${host(pageList[0].url)}:${pageStates[pageStates.length - 1].label} --headless`
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
