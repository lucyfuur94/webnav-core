// Observation-based inference primitives (settled 2026-07-10, structure-inference design).
// Pure + deterministic; ZERO site knowledge (#5a). Thresholds are documented tunables.

import type { SnapNode } from '../playwright/snapshot.js';

// Path segments of a URL. Accepts BOTH absolute (`https://h/v3/9999/x`) and RELATIVE
// (`/v3/9999/x`) forms — snapshot link hrefs are usually relative, and keying them must
// land on the same key as the absolute toUrl (else every sidebar link keys to `/` and no
// from-anywhere shell edge ever resolves). A dummy base makes the relative parse succeed
// without affecting the pathname.
const segsOf = (url: string): string[] => {
  try { return new URL(url, 'http://_').pathname.split('/').filter(Boolean); } catch { return []; }
};

export interface UrlModel { base: string[]; keyOf(url: string): string }

/** Site base = greedy leading segments shared by ≥80% of observed paths (e.g. version+tenant
 *  `v3/1041`). keyOf strips query/hash + the base segments IN ORDER WHERE PRESENT, so a
 *  pre-redirect URL missing the tenant still lands on the same key (the ghost merges). */
export function inferUrlModel(urls: string[]): UrlModel {
  let work = urls.map(segsOf);
  const base: string[] = [];
  for (;;) {
    const nonEmpty = work.filter((p) => p.length);
    if (!nonEmpty.length) break;
    const heads = new Map<string, number>();
    for (const p of nonEmpty) heads.set(p[0], (heads.get(p[0]) ?? 0) + 1);
    const [top, cnt] = [...heads.entries()].sort((a, b) => b[1] - a[1])[0];
    if (cnt < 0.8 * nonEmpty.length) break;
    base.push(top);
    work = work.map((p) => (p[0] === top ? p.slice(1) : p));
  }
  const keyOf = (url: string): string => {
    let p = segsOf(url);
    for (const b of base) if (p[0] === b) p = p.slice(1);
    return '/' + p.join('/');
  };
  return { base, keyOf };
}

export interface TemplateGroup { template: string; keys: string[]; paramPos: number }

/** PROPOSE param templates: keys of equal length differing at exactly one position (≥2 keys).
 *  Purely positional — no digit/hex shape guessing. The caller DISPOSES structurally. */
export function proposeTemplates(keys: string[]): TemplateGroup[] {
  const bySig = new Map<string, { keys: string[]; paramPos: number; parts: string[] }>();
  const parts = keys.map((k) => k.split('/').filter(Boolean));
  for (let i = 0; i < parts.length; i++) {
    for (let pos = 0; pos < parts[i].length; pos++) {
      const sig = parts[i].length + ':' + pos + ':' + parts[i].map((s, j) => (j === pos ? '{param}' : s)).join('/');
      const g = bySig.get(sig) ?? { keys: [], paramPos: pos, parts: parts[i] };
      g.keys.push(keys[i]);
      bySig.set(sig, g);
    }
  }
  return [...bySig.values()].filter((g) => g.keys.length >= 2).map((g) => ({
    template: '/' + g.parts.map((s, j) => (j === g.paramPos ? '{param}' : s)).join('/'),
    keys: g.keys, paramPos: g.paramPos,
  }));
}

export type Face = Set<string>;

export function faceOf(nodes: SnapNode[]): Face {
  const f: Face = new Set();
  for (const n of nodes) if (n.name && n.name.trim()) f.add(`${n.role}:${n.name}`);
  return f;
}

export function jaccard(a: Face, b: Face): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Containment |A∩B| / min(|A|,|B|): 1 when the smaller face is a subset of the larger. A
 *  PARTIAL RENDER (a page captured before its data grid arrived) reads as contained-in the full
 *  face even when jaccard is tiny (real case: 33-token subset of a 199-token list page → jaccard
 *  0.17, containment 1.0), while a genuinely different page is not. Thresholds live at call sites. */
export function containment(a: Face, b: Face): number {
  if (!a.size || !b.size) return a.size === b.size ? 1 : 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

// Interactive CONTROL roles — a template's SKELETON. Two instances of one page template share
// what you can DO (buttons/fields/tabs) even when their text/link tokens are all instance data
// (product names, prices, related items). Observational, no site tokens.
export const CONTROL_ROLES: ReadonlySet<string> =
  new Set(['button', 'textbox', 'combobox', 'searchbox', 'spinbutton', 'checkbox', 'tab']);

/** The sub-face of interactive-control tokens ('role:name' filtered to CONTROL_ROLES). */
export function controlFace(f: Face): Face {
  const out: Face = new Set();
  for (const t of f) if (CONTROL_ROLES.has(t.slice(0, t.indexOf(':')))) out.add(t);
  return out;
}

// Roles that DECLARE a transient overlay container (WAI-ARIA). A node nested under one is
// overlay content (a value being chosen, or the overlay's own controls) — never page structure.
export const OVERLAY_ROLES: ReadonlySet<string> = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip']);

/** Walk ancestors by indent depth (same containment logic shadow.ts uses): the nearest
 *  lower-depth predecessor chain; true if any ancestor's role declares an overlay. */
export function insideOverlay(nodes: SnapNode[], idx: number): boolean {
  if (idx < 0 || idx >= nodes.length) return false;
  let cur = nodes[idx].depth;
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].depth < cur) {
      if (OVERLAY_ROLES.has(nodes[i].role)) return true;
      cur = nodes[i].depth;
    }
  }
  return false;
}

export function nodeIndexByName(nodes: SnapNode[], name: string): number {
  return nodes.findIndex((n) => n.name === name);
}

/** IDENTITY SCOPING (X3, OQ1): when a landing DECLARES a `main` landmark, a state's identity is
 *  what's inside `main` — ancillary `complementary` rails / secondary nav that sit OUTSIDE `main`
 *  are chrome, not identity, and must not pollute the face (a per-page-varying rail is neither
 *  shell nor page-distinguishing). Same nearest-lower-depth containment idiom as `insideOverlay`:
 *  keep a node iff its ancestor chain passes through a `main` (or it IS the `main`). NO `main`
 *  declared → return nodes unchanged (declared-evidence-gated, never inferred). */
export function mainScope(nodes: SnapNode[]): SnapNode[] {
  if (!nodes.some((n) => n.role === 'main')) return nodes;
  const out: SnapNode[] = [];
  for (let idx = 0; idx < nodes.length; idx++) {
    if (nodes[idx].role === 'main') { out.push(nodes[idx]); continue; }
    let cur = nodes[idx].depth, inMain = false;
    for (let i = idx - 1; i >= 0 && !inMain; i--) {
      if (nodes[i].depth < cur) { if (nodes[i].role === 'main') inMain = true; cur = nodes[i].depth; }
    }
    if (inMain) out.push(nodes[idx]);
  }
  return out;
}

/** Shell = tokens present on ≥minFrac of DISTINCT pages. Needs ≥4 pages to claim anything —
 *  on tiny evidence a "shell" would just be coincidence. */
export function extractShell(faces: Face[], minFrac = 0.8): Face {
  if (faces.length < 4) return new Set();
  const count = new Map<string, number>();
  for (const f of faces) for (const t of f) count.set(t, (count.get(t) ?? 0) + 1);
  const shell: Face = new Set();
  for (const [t, c] of count) if (c >= minFrac * faces.length) shell.add(t);
  return shell;
}

// ── Subtree-template induction (2026-07-11, subtree-templates design) ──────────────────────────
// The repetition principle at its last scale: repeated sibling SUBTREES are instances of one
// sub-template; the varying residue is data. Pure tree fold over the parsed snapshot, zero site
// knowledge (#5a). This is the ONE general fold pass: it subsumed the old foldRepeats (a one-level
// subtree = the named/abstracted sibling case) and the draft-side enumeratedNames children fold —
// both deleted 2026-07-11; every consumer (interior synthesis, reveal children, fingerprints) reads
// foldedIndices here.

export interface SubtreeFold {
  sig: string;                 // 8-char stable hash of the firing level's structural signature
  level: 'named' | 'abstracted';
  count: number;               // number of member subtrees folded into this template
  memberIndices: number[];     // EVERY node index inside any member subtree (root + descendants)
  label: string;
  unitSize: number;            // node count of one member subtree (measured on the first member)
}

// Tiny deterministic string hash (djb2 → 8 hex). No crypto import — sigs need only be stable
// across runs and collision-resistant enough to key groups; they are not security material.
function sigHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Longest common trailing word(s) across names. Returns '' when the names share no trailing word.
// Anchors an abstracted fold's label ('OS Remove'/'Revenue Remove' → 'Remove').
function commonTrailingWords(names: string[]): string {
  const wordLists = names.map((n) => n.trim().split(/\s+/));
  const out: string[] = [];
  for (let back = 1; ; back++) {
    const words = wordLists.map((w) => (w.length >= back ? w[w.length - back] : undefined));
    if (words.some((w) => w === undefined) || new Set(words).size !== 1) break;
    out.unshift(words[0]!);
  }
  return out.join(' ');
}

/** Repeated sibling subtrees under a shared parent fold into typed sub-templates. Two signature
 *  levels, bottom-up:
 *    L1 (named)      role (+ "name" if role ∈ CONTROL_ROLES — control labels are the strongest
 *                    template evidence) + '(' + sorted children L1 sigs + ')'.
 *    L2 (abstracted) same, ALL names dropped — pure shape.
 *  Fold rules PER PARENT (thresholds evidence-scaled, documented here):
 *    (a) named ≥2      — ≥2 children sharing an L1 sig (identical repeated units; 'Expand drilldown' ×25).
 *    (b) abstracted ≥3 — among the still-unfolded children, ≥3 sharing an L2 sig across ≥2 DISTINCT
 *                        L1 sigs (the varying-name 'OS Remove'/'Revenue Remove' class). Higher bar:
 *                        an abstract match is weaker evidence than an exact-label repeat.
 *  A candidate unit must carry SOMETHING (a name or a control role somewhere in its subtree) — pure
 *  unnamed `generic` wrappers fold to nothing and are skipped. A node already inside a named fold is
 *  never reconsidered for abstracted folding. Pure + deterministic; no draft changes. */
export function subtreeFolds(nodes: SnapNode[]): { folds: SubtreeFold[]; foldedIndices: Set<number> } {
  const n = nodes.length;
  // Tree via depth stack: parent of node i = nearest preceding node with lower depth (the
  // containment idiom used everywhere). Root nodes (no lower-depth predecessor) get parent -1.
  const parent = new Array<number>(n).fill(-1);
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    while (stack.length && nodes[stack[stack.length - 1]].depth >= nodes[i].depth) stack.pop();
    if (stack.length) { parent[i] = stack[stack.length - 1]; children[parent[i]].push(i); }
    else roots.push(i);
    stack.push(i);
  }

  // Bottom-up signatures + subtree size + content flag. Children always follow their parent at
  // greater depth, so reverse index order is a valid post-order (child computed before parent).
  const l1 = new Array<string>(n), l2 = new Array<string>(n);
  const size = new Array<number>(n).fill(1);
  const hasContent = new Array<boolean>(n).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    const isControl = CONTROL_ROLES.has(nodes[i].role);
    const self = hasContent[i] || (nodes[i].name != null && nodes[i].name!.trim() !== '') || isControl;
    hasContent[i] = self;
    const kids = children[i];
    const k1: string[] = [], k2: string[] = [];
    for (const c of kids) { k1.push(l1[c]); k2.push(l2[c]); size[i] += size[c]; if (hasContent[c]) hasContent[i] = true; }
    k1.sort(); k2.sort();
    const label1 = nodes[i].role + (isControl && nodes[i].name ? '"' + nodes[i].name + '"' : '');
    l1[i] = label1 + '(' + k1.join(',') + ')';
    l2[i] = nodes[i].role + '(' + k2.join(',') + ')';
  }

  // All indices inside a subtree (root + descendants), document order.
  const subtreeIndices = (root: number): number[] => {
    const acc: number[] = [];
    const walk = (i: number) => { acc.push(i); for (const c of children[i]) walk(c); };
    walk(root);
    return acc;
  };
  // First control-role node WITH a name in a unit's subtree (document order) → its stable label.
  const firstControlName = (root: number): string | null => {
    for (const i of subtreeIndices(root)) {
      if (CONTROL_ROLES.has(nodes[i].role) && nodes[i].name && nodes[i].name!.trim()) return nodes[i].name!.trim();
    }
    return null;
  };

  const folds: SubtreeFold[] = [];
  const foldedIndices = new Set<number>();

  const foldUnderParent = (kids: number[]) => {
    const eligible = kids.filter((c) => hasContent[c]);   // skip pure unnamed wrappers
    // (a) NAMED: group by L1, groups ≥2.
    const byL1 = new Map<string, number[]>();
    for (const c of eligible) (byL1.get(l1[c]) ?? byL1.set(l1[c], []).get(l1[c])!).push(c);
    const claimed = new Set<number>();
    for (const [sig, members] of byL1) {
      if (members.length < 2) continue;
      for (const m of members) claimed.add(m);
      const mi: number[] = [];
      for (const m of members) for (const idx of subtreeIndices(m)) { mi.push(idx); foldedIndices.add(idx); }
      folds.push({
        sig: sigHash(sig), level: 'named', count: members.length, memberIndices: mi,
        label: firstControlName(members[0]) ?? nodes[members[0]].role, unitSize: size[members[0]],
      });
    }
    // (b) ABSTRACTED: among children NOT claimed by a named fold, group by L2; groups ≥3 with ≥2
    //     distinct L1 sigs (varying names are the param slots).
    const byL2 = new Map<string, number[]>();
    for (const c of eligible) { if (claimed.has(c)) continue; (byL2.get(l2[c]) ?? byL2.set(l2[c], []).get(l2[c])!).push(c); }
    for (const [sig, members] of byL2) {
      if (members.length < 3) continue;
      if (new Set(members.map((m) => l1[m])).size < 2) continue;   // identical units belong to named, not here
      const mi: number[] = [];
      for (const m of members) for (const idx of subtreeIndices(m)) { mi.push(idx); foldedIndices.add(idx); }
      // Label = longest common trailing word of the members' distinguishing names, else unit role.
      const names: string[] = [];
      for (const m of members) { const nm = firstControlName(m) ?? nodes[m].name; if (nm && nm.trim()) names.push(nm.trim()); }
      const trailing = names.length === members.length ? commonTrailingWords(names) : '';
      folds.push({
        sig: sigHash(sig), level: 'abstracted', count: members.length, memberIndices: mi,
        label: trailing || nodes[members[0]].role, unitSize: size[members[0]],
      });
    }
  };

  foldUnderParent(roots);
  for (let i = 0; i < n; i++) if (children[i].length) foldUnderParent(children[i]);
  return { folds, foldedIndices };
}

export interface CoreResult { tokens: Face; provisional: string | null }

/** A state's durable face = tokens repeating across its settled landings (majority k-of-n,
 *  0.6 — tolerates one A/B-noisy visit in three). ONE landing = no variance signal: keep all,
 *  mark provisional; analyse surfaces the note as a record-next request. */
export function templateCore(landingFaces: Face[]): CoreResult {
  if (landingFaces.length === 1) {
    return { tokens: new Set(landingFaces[0]), provisional: 'seen once — record another visit to separate structure from data' };
  }
  const need = Math.ceil(landingFaces.length * 0.6);
  const count = new Map<string, number>();
  for (const f of landingFaces) for (const t of f) count.set(t, (count.get(t) ?? 0) + 1);
  const tokens: Face = new Set();
  for (const [t, c] of count) if (c >= need) tokens.add(t);
  return { tokens, provisional: null };
}
