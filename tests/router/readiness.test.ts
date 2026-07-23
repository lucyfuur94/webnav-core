import { describe, it, expect } from 'vitest';
import { classifyReadiness, snapshotsPlateaued } from '../../src/router/readiness.js';

describe('classifyReadiness', () => {
  it('detects a Cloudflare interstitial (escalate, never evade)', () => {
    const yml = '- heading "Just a moment..." [ref=e1]\n- paragraph "Verify you are human by completing the action below."';
    expect(classifyReadiness(yml)).toBe('interstitial');
  });
  it('detects "checking your browser" interstitial even when sparse', () => {
    expect(classifyReadiness('- paragraph "Checking your browser before accessing the site."')).toBe('interstitial');
  });
  it('flags a sparse/nav-only shell as loading (wait & retry)', () => {
    const yml = '- link "Home" [ref=e1]\n- link "About" [ref=e2]';
    expect(classifyReadiness(yml)).toBe('loading');
  });
  it('flags an empty snapshot as loading', () => {
    expect(classifyReadiness('')).toBe('loading');
  });
  it('classifies a real content page as ready', () => {
    const yml = Array.from({length: 12}, (_, i) =>
      `- paragraph "Class ${i}: 6:00 AM CrossFit session with details about the workout" [ref=e${i}]`).join('\n');
    expect(classifyReadiness(yml)).toBe('ready');
  });
  it('does not misclassify a content page that merely contains the word human', () => {
    const yml = Array.from({length: 12}, (_, i) =>
      `- paragraph "Human resources article number ${i} about workplace policy and benefits" [ref=e${i}]`).join('\n');
    expect(classifyReadiness(yml)).toBe('ready'); // "human" alone isn't the bot-wall phrase
  });
});

// snapshotsPlateaued: the settle-stability comparator (design's "layered settle" truth
// test). Plateaued = (1) equal parsed node count AND (2) equal sorted multiset of
// TOKEN_ROLES identity tokens (role:name) — NOT exact-YAML equality (that's the walk's
// bot-throttle primitive, a different concern with different tolerance).
describe('snapshotsPlateaued', () => {
  it('a shell that grows into a full render has NOT plateaued', () => {
    const shell = '- heading "Dashboard" [ref=e1]\n- button "Menu" [ref=e2]';
    const full = Array.from({ length: 10 }, (_, i) => `- button "Widget ${i}" [ref=e${i + 3}]`).join('\n');
    expect(snapshotsPlateaued(shell, `${shell}\n${full}`)).toBe(false);
  });

  it('identical successive snapshots have plateaued', () => {
    const yml = '- heading "Dashboard" [ref=e1]\n- button "Refresh" [ref=e2]';
    expect(snapshotsPlateaued(yml, yml)).toBe(true);
  });

  it('a same-count rename of an identity token (button relabeled) has NOT plateaued', () => {
    const prev = '- heading "Dashboard" [ref=e1]\n- button "Save" [ref=e2]';
    const cur = '- heading "Dashboard" [ref=e1]\n- button "Submit" [ref=e2]';
    expect(snapshotsPlateaued(prev, cur)).toBe(false);
  });

  it('a paragraph clock ticking at constant node count HAS plateaued (ticker tolerance)', () => {
    // paragraph is not a TOKEN_ROLES identity role — a mutating clock/ticker text
    // must not burn the settle budget forever (map stores structure, not values).
    const prev = '- heading "Dashboard" [ref=e1]\n- paragraph "12:00:01" [ref=e2]\n- button "Refresh" [ref=e3]';
    const cur = '- heading "Dashboard" [ref=e1]\n- paragraph "12:00:02" [ref=e2]\n- button "Refresh" [ref=e3]';
    expect(snapshotsPlateaued(prev, cur)).toBe(true);
  });

  it('bulk hydration of new named identity nodes at the same total count is NOT plateaued', () => {
    // Pins the hydration-catch case: even if total node count somehow matched, added
    // named img/paragraph nodes are non-identity roles — but added BUTTONS are identity
    // and must be caught even when they replace equal-count filler.
    const prev = '- heading "Dash" [ref=e1]\n- generic "" [ref=e2]\n- generic "" [ref=e3]';
    const cur = '- heading "Dash" [ref=e1]\n- button "Export" [ref=e2]\n- button "Share" [ref=e3]';
    expect(snapshotsPlateaued(prev, cur)).toBe(false);
  });

  it('an IDENTICAL identity multiset with +3 extra NON-identity nodes is NOT plateaued (node-count clause)', () => {
    // The identity token multiset is byte-identical between the two, so ONLY the node-count
    // clause can reject this. Pins that clause directly: a chart/image hydration that adds
    // img/paragraph/generic bulk (109→300+ nodes, the design incident) without touching any
    // identity token must still read as "not plateaued yet".
    const identity = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- link "Home" [ref=e3]';
    const grown = `${identity}\n- img "chart" [ref=e4]\n- paragraph "loaded copy" [ref=e5]\n- generic "" [ref=e6]`;
    expect(snapshotsPlateaued(identity, grown)).toBe(false);
  });
});
