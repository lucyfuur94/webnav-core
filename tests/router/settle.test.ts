import { describe, it, expect, vi } from 'vitest';
import { settleSnapshot } from '../../src/router/browse.js';

// Layered settle (design: DOM-quiet fast path + plateau fallback). Env knobs are pinned
// tiny by tests/setup.ts (WEBNAV_SETTLE_QUIET_MS/GAP_MS/BUDGET_MS = 5/5/100) so a real
// (non-fake-timer) settle here never actually waits production budgets.

describe('settleSnapshot (fallback path — no evalJs)', () => {
  it('returns settled:true immediately on an interstitial (a wall is stable)', async () => {
    const r = await settleSnapshot(async () => '- heading "Just a moment..." [ref=e1]');
    expect(r).toEqual({ snapshot: '- heading "Just a moment..." [ref=e1]', settled: true });
  });

  it('retries while loading, then confirms plateau once ready — settled:true', async () => {
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    const snaps = ['- generic "spinner"', READY, READY];   // loading, then two identical ready reads
    let call = 0;
    const r = await settleSnapshot(async () => snaps[Math.min(call++, snaps.length - 1)]);
    expect(r.settled).toBe(true);
    expect(r.snapshot).toBe(READY);
  });

  it('a page that keeps growing past budget records the LAST snapshot with settled:false (never throws)', async () => {
    let call = 0;
    const snap = async () => {
      call++;
      // every read adds one more named button — never plateaus, never loading (>=8
      // content nodes from the start), so the fallback poll runs out the (tiny, tests/setup.ts) budget.
      const base = Array.from({ length: 8 }, (_, i) => `- heading "H${i}" [ref=e${i}]`).join('\n');
      return `${base}\n- button "Grown ${call}" [ref=eN${call}]`;
    };
    const r = await settleSnapshot(snap);
    expect(r.settled).toBe(false);
    expect(call).toBeGreaterThan(1);   // it actually retried, didn't just give up on sample 1
  });

  it('honors a supplied `first` sample as sample 1 (no extra snap() call for it)', async () => {
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    let calls = 0;
    const r = await settleSnapshot(async () => { calls++; return READY; }, READY);
    expect(r.snapshot).toBe(READY);
    expect(r.settled).toBe(true);
    expect(calls).toBe(1);   // `first` counted as sample 1; only ONE more read needed to confirm plateau
  });
});

describe('settleSnapshot (fast path — evalJs present)', () => {
  it('awaits DOM-quiet via evalJs once, then confirms with a snapshot-plateau pair', async () => {
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    let evalCalls = 0;
    let snapCalls = 0;
    const r = await settleSnapshot(
      async () => { snapCalls++; return READY; },
      undefined,
      { evalJs: async () => { evalCalls++; return 'quiet'; } },
    );
    expect(r).toEqual({ snapshot: READY, settled: true });
    expect(evalCalls).toBe(1);      // ONE round-trip for the DOM-quiet wait
    expect(snapCalls).toBe(2);      // exactly the plateau-pair confirm
  });

  it('an interstitial short-circuits before any evalJs round-trip', async () => {
    let evalCalls = 0;
    const r = await settleSnapshot(
      async () => '- heading "Checking your browser before accessing the site." [ref=e1]',
      undefined,
      { evalJs: async () => { evalCalls++; return 'quiet'; } },
    );
    expect(r.settled).toBe(true);
    expect(evalCalls).toBe(0);
  });

  it('falls back to plateau polling if the DOM never goes quiet (evalJs reports budget)', async () => {
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    const r = await settleSnapshot(
      async () => READY,
      undefined,
      { evalJs: async () => 'budget' },   // DOM never quieted within evalJs's own cap
    );
    // still resolves via the plateau confirm on a page that IS actually stable.
    expect(r.settled).toBe(true);
    expect(r.snapshot).toBe(READY);
  });
});
