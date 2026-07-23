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
import { NAME_PROBE_JS, enrichName } from './agent-session.js';
import { parseEvalResult } from '../router/browse.js';

// Roles that are a real interactive control worth hovering — ANY such node is a candidate,
// not just ones inside a landmark: a hidden hover flyout can't be predicted without hovering
// it, so content-area icon buttons, pagination, tabs, toolbar buttons all qualify too.
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'combobox', 'checkbox', 'radio', 'switch']);
const HASPOPUP_RE = /\[aria-haspopup(?:=|\])/;

/** STRUCTURAL, judgment-free candidate selection: EVERY interactive node on the page (named
 *  or not — an unnamed icon button may still reveal a tooltip/menu on hover, which is exactly
 *  what we want to discover), plus any node declaring aria-haspopup. Requires a ref (can only
 *  hover a resolvable element), deduped by ref, capped (default 60 — generous enough to cover
 *  a real page's full interactive set without being unbounded). Zero cost on a page with none. */
export function hoverCandidates(nodes: SnapNode[], limit = 60): SnapNode[] {
  const out: SnapNode[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (!n.ref || seen.has(n.ref)) continue;
    const isCandidate = HASPOPUP_RE.test(n.raw) || INTERACTIVE_ROLES.has(n.role);
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
  // best-effort DOM name-probe (title/aria/tooltip) for an unnamed candidate — same
  // mechanism as agent-session's hover branch (NAME_PROBE_JS). Optional: a bare adapter
  // with no evalJs just leaves unnamed candidates unnamed.
  evalJs?(js: string, ref?: string): Promise<string>;
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
    // NAME-PROBE an unnamed candidate before acting: an icon-only button reveals a
    // tooltip/menu but its a11y name is empty — recover a human label from its own
    // attributes (title/aria-label/tooltip) the same way agent-session's hover branch
    // does, so the recorded reveal effect carries a usable name when one exists. No new
    // probe mechanism — reuse NAME_PROBE_JS/enrichName. Best-effort: a page that blocks
    // eval, or truly no recoverable label, just leaves the candidate nameless (honest —
    // draftFromEffects already handles a nameless affordance).
    let name = c.name;
    if (!(name ?? '').trim() && adapter.evalJs) {
      const probed = parseEvalResult(await adapter.evalJs(NAME_PROBE_JS, ref).catch(() => ''));
      name = enrichName(name, probed);
    }
    // Ledger the intent BEFORE acting (same discipline as the agent-session hover branch):
    // a probe that fails to reveal still leaves an honest trace of what we tried.
    const led = store.appendEvent(sessionId, {
      source: 'agent', kind,
      descriptor: { cmd: kind, ref, role: c.role, name, url },
    });
    const from = await adapter.snapshot();     // re-baseline per candidate (a prior Escape may have changed the page)
    if (rightClick) await adapter.rightClick(ref); else await adapter.hover(ref);
    // A reveal is an IN-PAGE overlay, not a navigation — capture it IMMEDIATELY, do NOT settle.
    // settle-by-quiescence is scoped to navigated landings only (runActionRecorded settles just
    // when navigated; the extension plateaus just when a navigated step is pending). A hover
    // mega-menu / context menu can auto-dismiss or keep animating during settle's ≥800ms
    // plateau gap, losing or thrashing the reveal diff — so the bare post-hover snapshot IS the
    // reveal, same discipline as the agent-session hover branch.
    const to = await adapter.snapshot();
    const diff = diffSnapshots(parseSnapshot(from), parseSnapshot(to));
    if (diff.added.length > 0) {
      const action = { role: c.role, name, ref, ...(rightClick ? { rightClick: true } : { hover: true }) };
      const seq = store.appendActionEffect(sessionId, {
        fromUrl: url, fromSnapshot: from, action, toUrl: url, toSnapshot: to, navigated: false, diff,
      });
      if (led != null && seq != null) store.stampEvent(sessionId, led, 'step:' + seq);
      revealed++;
      log(`  ${kind} ${name ?? ref}: +${diff.added.length} node(s) → reveal`);
    } else {
      // honest no-op: a candidate that reveals nothing records no affordance.
      if (led != null) store.stampEvent(sessionId, led, 'dropped:no-reveal');
    }
    await adapter.press('Escape').catch(() => {});   // neutralize so the next candidate's diff is clean
  }
  return { probed: candidates.length, revealed };
}
