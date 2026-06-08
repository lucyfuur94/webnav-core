import type { StoredActionEffect, ActionRef } from '../mapstore/record.js';
import type { SnapNode } from '../playwright/snapshot.js';

export interface AnalysedObservation {
  fromUrl: string;
  action: ActionRef | null;
  toUrl: string;
  navigated: boolean;
  addedSummary: string[];     // readable summary of diff.added (raw snapshots stay in the buffer)
  removedSummary: string[];
}
export interface AnalysedSite { node: string; observations: AnalysedObservation[]; }
export interface AnalysisResult { sites: AnalysedSite[]; }

function host(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}
const summarize = (nodes: SnapNode[]) =>
  nodes.map((n) => `${n.role}${n.name ? ` "${n.name}"` : ''}`);

/**
 * Structure-NEUTRAL presentation of recorded action-effects. Groups by host
 * (the only grouping — a convenience), and returns each observation as-is:
 * what page, what action, where it went, whether it navigated, and a readable
 * diff summary. webnav imposes NO structure (no states/clusters/edges) — the
 * calling AGENT reads this and decides the site's structure, then writes it via
 * graph-edit. The full raw snapshots remain in the record buffer for the agent.
 */
export function analyseActionEffects(effects: StoredActionEffect[]): AnalysisResult {
  const byHost = new Map<string, AnalysedObservation[]>();
  for (const e of effects) {
    // Group by the page the action was taken ON (fromUrl). A navigation
    // observation (from A → to B) is "what happened on A", so it belongs to A's
    // host — including the act of leaving for another site. Fall back to toUrl
    // only when fromUrl has no host (e.g. a null-action initial landing).
    const h = host(e.fromUrl) ?? host(e.toUrl);
    if (!h) continue;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push({
      fromUrl: e.fromUrl, action: e.action, toUrl: e.toUrl, navigated: e.navigated,
      addedSummary: summarize(e.diff.added), removedSummary: summarize(e.diff.removed),
    });
  }
  const sites = [...byHost.entries()]
    .map(([node, observations]) => ({ node, observations }))
    .sort((a, b) => a.node.localeCompare(b.node));
  return { sites };
}
