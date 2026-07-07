import type { MapStore } from '../mapstore/store.js';
import { seedSaucedemoComplete } from '../router/walk-live.js';

/**
 * Seed the out-of-the-box map for a FRESH install (idempotent upserts).
 *
 * Deliberately MINIMAL: the ONLY thing seeded is the **saucedemo** walk map — a
 * single, complete worked example (login → checkout-complete + the burger menu)
 * so `webnav walk` does something real on first run. Everything else a new user
 * builds themselves (record → graph-analyse --draft → graph-edit). webnav is a
 * blank-slate map tool; saucedemo is just the example that proves it works.
 */
export function seedGraph(store: MapStore): void {
  seedSaucedemoComplete(store);
}

/**
 * Ensure the default out-of-the-box map is present — but ONLY on a DB where the
 * user has never touched saucedemo (no node row). The old guard keyed on a known
 * interior STATE (checkout-complete), which meant any user-authored saucedemo map
 * lacking that exact state was force-re-seeded on EVERY open: `dev node-clear`
 * (the documented re-learn flow) was silently undone, and a human-recorded map
 * collided with the resurrected seed (live finding: walk matched both the seeded
 * `inventory` and the drafted `inventory-html` → ambiguous). A node-row guard
 * respects clear/re-author; the trade-off: `node-rm` of saucedemo brings the
 * shipped example back on next open (to re-learn, use node-clear — that sticks).
 */
export function ensureSeeded(store: MapStore): void {
  if (store.getNode('www.saucedemo.com') === null) {
    seedGraph(store);
  }
}
