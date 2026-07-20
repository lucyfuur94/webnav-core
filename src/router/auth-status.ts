import { parseSnapshot } from '../playwright/snapshot.js';
import { matchState } from '../explorer/fingerprint.js';
import { classifyReadiness } from './readiness.js';
import type { State } from '../mapstore/types.js';

export type AuthStatus = 'valid' | 'needs-login' | 'unknown';

export interface AuthClassification {
  auth: AuthStatus;
  loginUrl?: string;   // set when auth === 'needs-login' — the landed (walled) url
}

/** Host of a URL, or null if unparseable (never throws — same posture as
 *  playwright/throttle.ts's hostOf). */
function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

/** A password field, going only by what parseSnapshot actually exposes: role
 *  `textbox` with an accessible name matching /password/i. playwright-cli's a11y
 *  snapshot carries no HTML `type=` attribute, so this is the honest signal
 *  available (per the design doc) — not a substitute for a real type=password read. */
function hasPasswordField(nodes: ReturnType<typeof parseSnapshot>): boolean {
  return nodes.some((n) => n.role === 'textbox' && /password/i.test(n.name ?? ''));
}

/**
 * Classify a settled landing page as evidence of whether a profile is still
 * logged in for `site` (a site-node id / host). Judgment-free: no site-specific
 * rules, just the three honest signals from the design doc. Reused by the verb
 * (Task A) and by the walk/use-navigate wall-handling escalation (Task 2).
 *
 *   valid        — the snapshot matches a known map content state (⇒ logged in and on a
 *                  real page — this is the STRONGEST signal, so it wins over the URL-host
 *                  heuristic below), OR the landing is on `site`'s host with no wall signal.
 *   needs-login  — foreign-host landing, OR an interstitial/bot-wall, OR a password
 *                  field is present. loginUrl = the landed url.
 *   unknown      — everything else (no map yet / ambiguous landing on the right host).
 */
export function classifyAuthLanding(
  landedUrl: string, snapshotYaml: string, site: string, states: State[],
): AuthClassification {
  const nodes = parseSnapshot(snapshotYaml);

  // MATCH FIRST — a snapshot that matches a known content state (non-empty fingerprint,
  // every token present; matchState never matches a bare login/shell page) is direct
  // proof the profile is logged in and on a real page. It OVERRIDES the URL-host
  // heuristic below: `landedUrl` can be a stale/withheld reading from the driver (e.g.
  // the extension's chrome.tabs.get returns '' or a mid-navigation host), which used to
  // trip `foreignHost` and fire a false `needs-login` on an authed SPA. The page itself
  // is the honest evidence; trust it over the address bar.
  if (matchState(nodes, states).status === 'matched') return { auth: 'valid' };

  const landedHost = hostOf(landedUrl);
  const foreignHost = landedHost !== null && landedHost !== site;
  if (foreignHost) return { auth: 'needs-login', loginUrl: landedUrl };

  if (classifyReadiness(snapshotYaml) === 'interstitial') {
    return { auth: 'needs-login', loginUrl: landedUrl };
  }

  if (hasPasswordField(nodes)) return { auth: 'needs-login', loginUrl: landedUrl };

  return { auth: 'unknown' };
}
