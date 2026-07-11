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
 *   valid        — landed on `site`'s host AND the snapshot matches a known map state.
 *   needs-login  — foreign-host landing, OR an interstitial/bot-wall, OR a password
 *                  field is present. loginUrl = the landed url.
 *   unknown      — everything else (no map yet / ambiguous landing on the right host).
 */
export function classifyAuthLanding(
  landedUrl: string, snapshotYaml: string, site: string, states: State[],
): AuthClassification {
  const landedHost = hostOf(landedUrl);
  const foreignHost = landedHost !== null && landedHost !== site;
  if (foreignHost) return { auth: 'needs-login', loginUrl: landedUrl };

  if (classifyReadiness(snapshotYaml) === 'interstitial') {
    return { auth: 'needs-login', loginUrl: landedUrl };
  }

  const nodes = parseSnapshot(snapshotYaml);
  if (hasPasswordField(nodes)) return { auth: 'needs-login', loginUrl: landedUrl };

  const matched = matchState(nodes, states);
  if (matched.status === 'matched') return { auth: 'valid' };

  return { auth: 'unknown' };
}
