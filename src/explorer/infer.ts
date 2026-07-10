// Observation-based inference primitives (settled 2026-07-10, structure-inference design).
// Pure + deterministic; ZERO site knowledge (#5a). Thresholds are documented tunables.

import type { SnapNode } from '../playwright/snapshot.js';

const segsOf = (url: string): string[] => {
  try { return new URL(url).pathname.split('/').filter(Boolean); } catch { return []; }
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
