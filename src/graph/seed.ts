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
 * Ensure the default out-of-the-box map is present. Guard on a known saucedemo
 * interior state (NOT a node-only check): a pre-existing webnav.db may have older
 * data but lack the full saucedemo walk map. seedGraph's upserts are idempotent,
 * so re-running is cheap+safe.
 */
export function ensureSeeded(store: MapStore): void {
  if (store.getState('www.saucedemo.com:checkout-complete') === null) {
    seedGraph(store);
  }
}
