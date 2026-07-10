// Observation-based inference primitives (settled 2026-07-10, structure-inference design).
// Pure + deterministic; ZERO site knowledge (#5a). Thresholds are documented tunables.

import type { SnapNode } from '../playwright/snapshot.js';

// Path segments of a URL. Accepts BOTH absolute (`https://h/v3/1041/x`) and RELATIVE
// (`/v3/1041/x`) forms — snapshot link hrefs are usually relative, and keying them must
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

export interface FoldedRepeat { role: string; suffix: string; count: number }

/** ≥3 same-role, same-depth nodes whose names share a common trailing word (with DISTINCT
 *  varying prefixes) are one value-bound affordance repeated per row/chip — fold to a single
 *  scope:'row' template. Evidence-only: repetition IS the signal, no meaning guessed. */
export function foldRepeats(nodes: SnapNode[]): { folds: FoldedRepeat[]; foldedNames: Set<string> } {
  const groups = new Map<string, string[]>();   // role|depth|lastWord → full names
  for (const n of nodes) {
    if (!n.name || !n.name.trim()) continue;
    const words = n.name.trim().split(/\s+/);
    if (words.length < 2) continue;             // need a prefix + suffix
    const key = `${n.role}|${n.depth}|${words[words.length - 1]}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n.name);
  }
  const folds: FoldedRepeat[] = [];
  const foldedNames = new Set<string>();
  for (const [key, names] of groups) {
    const distinct = new Set(names);
    if (distinct.size < 3) continue;
    const [role, , suffix] = key.split('|');
    folds.push({ role, suffix, count: distinct.size });
    for (const nm of distinct) foldedNames.add(nm);
  }
  return { folds, foldedNames };
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
