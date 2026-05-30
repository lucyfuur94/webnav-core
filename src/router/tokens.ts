/**
 * Token estimation for the cost thesis (criterion #2). The real saving webnav
 * delivers is the calling AGENT's LLM tokens: without webnav, the agent would
 * have to ingest every raw page snapshot into its own context and reason about
 * navigation. webnav parses those snapshots deterministically (zero LLM) and
 * returns a compact evidence bundle instead. The saving = tokens in the raw
 * snapshots the agent DIDN'T read, minus the tokens in the bundle it DID receive.
 *
 * Estimate, not exact: ~4 characters per token is the standard rough heuristic
 * for English/markup. We report it as an estimate, never as a precise count.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TokenSavings {
  /** Estimated tokens the agent would have ingested reading the raw snapshots itself. */
  raw_snapshot_tokens: number;
  /** Estimated tokens of the compact bundle the agent actually receives. */
  bundle_tokens: number;
  /** raw_snapshot_tokens - bundle_tokens (>= 0). The agent-token cost webnav absorbs. */
  tokens_saved: number;
  /** Rough chars-per-token divisor used for the estimate (for transparency). */
  chars_per_token: number;
}

/** Compute the savings estimate from total raw snapshot chars vs. the bundle's serialized size. */
export function tokenSavings(rawSnapshotChars: number, bundleSerialized: string): TokenSavings {
  const raw = Math.ceil(rawSnapshotChars / CHARS_PER_TOKEN);
  const bundle = estimateTokens(bundleSerialized);
  return {
    raw_snapshot_tokens: raw,
    bundle_tokens: bundle,
    tokens_saved: Math.max(0, raw - bundle),
    chars_per_token: CHARS_PER_TOKEN,
  };
}
