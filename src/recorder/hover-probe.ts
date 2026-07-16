// X2 — hover / right-click reveal probe (spec 2026-07-16 §2). A hover mega-menu or a
// context menu appears in NO settled snapshot and declares no trigger, so the map
// honestly omits a site's primary nav. This opt-in pass, over the CURRENT page of a
// live recording session, hovers (or right-clicks) each STRUCTURAL candidate, diffs
// the reveal, and records an ActionEffect the draft already turns into a reveal
// affordance (draftFromEffects is diff-driven — the `hover`/`rightClick` markers only
// name the kind; the reveal decision is behavioral).
//
// REVEAL ONLY: the probe never clicks anything INSIDE a revealed menu (commit rule #2).
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { diffSnapshots } from '../explorer/diff.js';
import { settleSnapshot } from '../router/browse.js';

// Landmark roles whose named interactive descendants are primary-nav triggers worth probing.
const LANDMARK_ROLES = new Set(['banner', 'navigation']);
// Roles that are a real interactive control (so "named interactive inside a landmark" is honest).
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'combobox', 'checkbox', 'radio', 'switch']);
const HASPOPUP_RE = /\[aria-haspopup(?:=|\])/;

// Nearest-lower-depth ancestor walk (the insideOverlay idiom in infer.ts): is node `idx`
// inside a banner/navigation landmark subtree? Depth = leading-space count, so an ancestor
// is any earlier node at a strictly smaller depth.
function insideLandmark(nodes: SnapNode[], idx: number): boolean {
  let cur = nodes[idx].depth;
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].depth < cur) {
      if (LANDMARK_ROLES.has(nodes[i].role)) return true;
      cur = nodes[i].depth;
    }
  }
  return false;
}

/** STRUCTURAL, judgment-free candidate selection: nodes with aria-haspopup, menuitems, and
 *  named interactive nodes inside a banner/navigation landmark. Requires a ref (can only hover
 *  a resolvable element), deduped by ref, capped (default 12). Zero cost on a page with none. */
export function hoverCandidates(nodes: SnapNode[], limit = 12): SnapNode[] {
  const out: SnapNode[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.ref || seen.has(n.ref)) continue;
    const isCandidate =
      HASPOPUP_RE.test(n.raw)                                         // declares a popup
      || n.role === 'menuitem'                                        // a menu entry (may open a submenu)
      || (!!n.name && INTERACTIVE_ROLES.has(n.role) && insideLandmark(nodes, i));  // primary-nav trigger
    if (!isCandidate) continue;
    seen.add(n.ref);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

export interface HoverProbeStore {
  isActive(sessionId: string): boolean;
  appendActionEffect(sessionId: string, fx: unknown): number | null;
  appendEvent(sessionId: string, ev: unknown): number | null;
  stampEvent(sessionId: string, seq: number, disposition: string): void;
}
export interface HoverProbeAdapter {
  snapshot(): Promise<string>;
  hover(ref: string): Promise<unknown>;
  rightClick(ref: string): Promise<unknown>;
  press(key: string): Promise<unknown>;
  currentUrl(): Promise<string>;
}
export interface HoverProbeDeps {
  adapter: HoverProbeAdapter;
  store: HoverProbeStore;
  sessionId: string;
  limit: number;
  rightClick: boolean;
  log: (line: string) => void;
}

/** Probe the CURRENT page: per candidate, take a baseline snapshot, hover (or right-click),
 *  settle, diff; a non-empty ADDED diff records a reveal effect + a ledger event. Between
 *  candidates we press Escape to dismiss the just-opened overlay so reveals don't stack
 *  (Escape is the honest neutralizer — a re-hover of some "neutral" node is itself a guess
 *  at what's neutral; Escape closes menus/popovers without moving the pointer anywhere real). */
export async function runHoverProbe(deps: HoverProbeDeps): Promise<{ probed: number; revealed: number }> {
  const { adapter, store, sessionId, rightClick, log } = deps;
  const baseline = await adapter.snapshot();
  const url = await adapter.currentUrl();
  const candidates = hoverCandidates(parseSnapshot(baseline), deps.limit);
  const kind = rightClick ? 'right-click' : 'hover';
  log(`${kind}-probe: ${candidates.length} candidate(s) on ${url}`);
  let revealed = 0;
  for (const c of candidates) {
    const ref = c.ref!;
    // Ledger the intent BEFORE acting (same discipline as the agent-session hover branch):
    // a probe that fails to reveal still leaves an honest trace of what we tried.
    const led = store.appendEvent(sessionId, {
      source: 'agent', kind,
      descriptor: { cmd: kind, ref, role: c.role, name: c.name, url },
    });
    const from = await adapter.snapshot();     // re-baseline per candidate (a prior Escape may have changed the page)
    if (rightClick) await adapter.rightClick(ref); else await adapter.hover(ref);
    const to = await settleSnapshot(() => adapter.snapshot());
    const diff = diffSnapshots(parseSnapshot(from), parseSnapshot(to));
    if (diff.added.length > 0) {
      const action = { role: c.role, name: c.name, ref, ...(rightClick ? { rightClick: true } : { hover: true }) };
      const seq = store.appendActionEffect(sessionId, {
        fromUrl: url, fromSnapshot: from, action, toUrl: url, toSnapshot: to, navigated: false, diff,
      });
      if (led != null && seq != null) store.stampEvent(sessionId, led, 'step:' + seq);
      revealed++;
      log(`  ${kind} ${c.name ?? ref}: +${diff.added.length} node(s) → reveal`);
    } else {
      // honest no-op: a candidate that reveals nothing records no affordance.
      if (led != null) store.stampEvent(sessionId, led, 'dropped:no-reveal');
    }
    await adapter.press('Escape').catch(() => {});   // neutralize so the next candidate's diff is clean
  }
  return { probed: candidates.length, revealed };
}
