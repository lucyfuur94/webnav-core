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

  it('retries through MULTIPLE loading samples, then settles once ready+plateau (T2: floor-retry preserved)', async () => {
    // Pins the retry-while-loading floor layer across more than one loading sample: the
    // budget-bounded loading loop must keep going (loading→loading→…) and only hand off to
    // the plateau confirm once classifyReadiness clears 'loading'.
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    const snaps = ['- generic "spinner"', '- generic "still spinning"', READY, READY];
    let call = 0;
    const r = await settleSnapshot(async () => snaps[Math.min(call++, snaps.length - 1)]);
    expect(r.settled).toBe(true);
    expect(r.snapshot).toBe(READY);
    expect(call).toBeGreaterThanOrEqual(4);   // two loading reads + the plateau confirm pair
  });

  it('an interstitial appearing on a LATER sample settles true immediately (T3: not just sample 1)', async () => {
    // The existing interstitial test only covers a wall on sample 1. A wall that appears AFTER
    // a loading tick (a JS-injected Cloudflare challenge) must ALSO short-circuit to settled:true
    // the moment it's detected — a wall is stable, report it, never wait it out.
    const WALL = '- heading "Just a moment..." [ref=e1]';
    const snaps = ['- generic "spinner"', WALL];
    let call = 0;
    const r = await settleSnapshot(async () => snaps[Math.min(call++, snaps.length - 1)]);
    expect(r).toEqual({ snapshot: WALL, settled: true });
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

  it('reads WEBNAV_SETTLE_BUDGET_MS at CALL time, not module load (T4: no env hoisting)', async () => {
    // setup.ts pins the budget to 100ms globally. Override it INSIDE this test body and drive
    // a page that NEVER plateaus (grows every read): the number of poll iterations before
    // giving up scales with the budget in force AT CALL TIME. A small budget yields a handful
    // of reads; a large one reads many more. If the budget were captured at module load
    // (hoisted to setup.ts's 100), the override would have no effect. Comparing the two
    // read-counts proves the env is read per call. Uses a tiny gap so many iterations fit.
    // NOTE: budget is taken from process.env (NOT opts) so this genuinely exercises the
    // call-time env read — the whole point of the pin. Only gapMs is passed via opts (tiny,
    // so many iterations fit the window; gap isn't what T4 is testing).
    const runGrowing = async (): Promise<number> => {
      let call = 0;
      await settleSnapshot(async () => {
        call++;
        const base = Array.from({ length: 8 }, (_, i) => `- heading "H${i}" [ref=e${i}]`).join('\n');
        return `${base}\n- button "Grown ${call}" [ref=eN${call}]`;   // never plateaus
      }, undefined, { gapMs: 1 });
      return call;
    };
    const savedBudget = process.env.WEBNAV_SETTLE_BUDGET_MS;
    try {
      process.env.WEBNAV_SETTLE_BUDGET_MS = '20';
      const smallCalls = await runGrowing();
      process.env.WEBNAV_SETTLE_BUDGET_MS = '300';
      const bigCalls = await runGrowing();
      expect(bigCalls).toBeGreaterThan(smallCalls);   // larger call-time budget ⇒ more poll iterations
    } finally {
      process.env.WEBNAV_SETTLE_BUDGET_MS = savedBudget;
    }
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

  // PRODUCTION SHAPE (F1 regression): playwright-cli's eval output is NOT a bare value —
  // it echoes the executed SOURCE inside a `### Ran Playwright code` block. domQuietJs's
  // source literally contains the word "quiet", so a naive `raw.includes('quiet')` fast-path
  // check is ALWAYS true regardless of the real verdict. The fast path MUST parse the
  // `### Result` value (parseEvalResult) and act only on that.
  const RESULT_WRAPPER = (result: string, source: string) =>
    `### Result\n${result}\n### Ran Playwright code\n${source}\n### Page\n- heading "x"`;
  // a real domQuietJs-shaped source (contains the literal word "quiet" in its own code).
  const QUIET_SOURCE = "() => new Promise((resolve) => { obs.disconnect(); resolve('quiet'); })";

  it('does NOT enter the fast-path confirm on a "budget" verdict wrapped in playwright chrome (F1)', async () => {
    // The verdict is "budget" (DOM never quieted). The fast path must NOT fire — it may only
    // fire on a parsed "quiet" value. Discriminator: the fast-path confirm snapshot is taken
    // WITHOUT a preceding sleep; the fallback poll always sleeps first. We record, per snap
    // call, whether a sleep-marker was set since the eval resolved. The buggy
    // `raw.includes('quiet')` check sees "quiet" in the echoed SOURCE and takes an immediate
    // (sleepless) confirm snapshot — which this test forbids on a "budget" verdict.
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    let evalDone = false;
    let sleptSinceEval = false;
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (evalDone) sleptSinceEval = true;   // a settle-loop sleep occurred after the eval resolved
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
    const firstSnapSleptFlags: boolean[] = [];
    try {
      await settleSnapshot(
        async () => { if (evalDone) firstSnapSleptFlags.push(sleptSinceEval); return READY; },
        READY,
        { evalJs: async () => { evalDone = true; return RESULT_WRAPPER('"budget"', QUIET_SOURCE); } },
      );
    } finally {
      spy.mockRestore();
    }
    // The FIRST snapshot taken after the eval resolved must have been preceded by a sleep
    // (fallback poll), never an immediate fast-path confirm.
    expect(firstSnapSleptFlags[0]).toBe(true);
  });

  it('triggers the fast path only on a parsed "quiet" Result value (F1)', async () => {
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    let snapCalls = 0;
    const r = await settleSnapshot(
      async () => { snapCalls++; return READY; },
      undefined,
      { evalJs: async () => RESULT_WRAPPER('"quiet"', QUIET_SOURCE) },
    );
    expect(r).toEqual({ snapshot: READY, settled: true });
    expect(snapCalls).toBe(2);   // fast path fired: exactly the plateau-pair confirm, no fallback polling
  });

  it('caps the DOM-quiet eval below the full budget so the plateau fallback still runs (F2)', async () => {
    // A continuously-churning page (marquee/60fps DOM): the DOM never goes quiet, so the eval
    // consumes its whole cap and resolves "budget". If that cap were the ENTIRE remaining
    // budget, nothing would be left for the plateau poll — the comparator built to tolerate
    // churn-at-constant-structure would never get to run. The eval must be capped to a
    // fraction, leaving room to reach the fallback and settle via snapshot plateau.
    const READY = '- heading "Dash" [ref=e1]\n- button "Refresh" [ref=e2]\n- button "Export" [ref=e3]\n'
      + '- link "Home" [ref=e4]\n- link "Help" [ref=e5]\n- textbox "Search" [ref=e6]\n'
      + '- paragraph "Welcome" [ref=e7]\n- listitem "Row 1" [ref=e8]';
    let evalDone = false;
    let snappedAfterEval = false;
    const r = await settleSnapshot(
      async () => { if (evalDone) snappedAfterEval = true; return READY; },
      undefined,
      { evalJs: async () => { evalDone = true; return RESULT_WRAPPER('"budget"', QUIET_SOURCE); } },
    );
    expect(r.settled).toBe(true);        // reached settled via the fallback poll's plateau
    expect(snappedAfterEval).toBe(true); // snap() actually ran AFTER the eval resolved (fallback got budget)
  });
});
