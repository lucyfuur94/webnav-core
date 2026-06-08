import type { SnapNode } from '../playwright/snapshot.js';

export interface SnapshotDiff { added: SnapNode[]; removed: SnapNode[]; }

const idOf = (n: SnapNode) => `${n.role}|${n.name ?? ''}|${n.ref ?? ''}`;

/** Mechanical set-difference of two parsed snapshots by node identity
 *  (role|name|ref). Pure convenience over the raw snapshots — not a judgment. */
export function diffSnapshots(before: SnapNode[], after: SnapNode[]): SnapshotDiff {
  const beforeIds = new Set(before.map(idOf));
  const afterIds = new Set(after.map(idOf));
  return {
    added: after.filter((n) => !beforeIds.has(idOf(n))),
    removed: before.filter((n) => !afterIds.has(idOf(n))),
  };
}

/** Did the action navigate to a different page? Compares host+pathname only
 *  (query/hash changes are same-page). Unparseable → treat as navigation. */
export function didNavigate(fromUrl: string, toUrl: string): boolean {
  try {
    const a = new URL(fromUrl), b = new URL(toUrl);
    return a.host !== b.host || a.pathname !== b.pathname;
  } catch {
    return fromUrl !== toUrl;
  }
}
