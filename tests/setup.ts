// Global vitest setup. settleSnapshot's layered settle (src/router/browse.ts) reads
// WEBNAV_SETTLE_*_MS at call time; pin them tiny here so a real (non-fake-timer) settle
// in a unit test never actually sleeps for the production budgets (10s/600ms/800ms) —
// a single file-scoped override would work too, but every fixture that exercises
// settleSnapshot would need to remember it. Set once, globally, per plan design.
process.env.WEBNAV_SETTLE_QUIET_MS = '5';
process.env.WEBNAV_SETTLE_GAP_MS = '5';
process.env.WEBNAV_SETTLE_BUDGET_MS = '100';
