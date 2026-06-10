-- Turso (libSQL/SQLite) schema for the webnav HOSTED shared-knowledge service.
--
-- HARD INVARIANT (CLAUDE.md): this central store holds the MAP SKELETON ONLY —
-- site navigation structure (nodes + states/affordances as JSON). It has NO
-- credential columns and never stores user logins. Site credentials live ONLY on
-- the user's machine (~/.webnav/credentials.json) and are filled by the local
-- browser at walk time.

-- One row per shared site map. `node_json` and `states_json` are the serialized
-- SiteNode and State[] (the same shapes the CLI's MapStore upserts).
CREATE TABLE IF NOT EXISTS shared_maps (
  site         TEXT PRIMARY KEY,         -- e.g. 'www.saucedemo.com'
  node_json    TEXT NOT NULL,            -- JSON of SiteNode
  states_json  TEXT NOT NULL,            -- JSON of State[] (incl. affordances)
  state_count  INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Free/paid API keys. `tier` selects the monthly quota (see pricing). No PII
-- required; email is optional and only for key recovery/notices.
CREATE TABLE IF NOT EXISTS api_keys (
  key         TEXT PRIMARY KEY,          -- e.g. 'wn_live_...'
  tier        TEXT NOT NULL DEFAULT 'free',
  email       TEXT,
  created_at  INTEGER NOT NULL
);

-- One row per metered action (a map fetch on the hosted route). Aggregated per
-- key + calendar month to enforce quotas; the raw rows allow precise billing.
CREATE TABLE IF NOT EXISTS usage (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  key     TEXT NOT NULL,
  site    TEXT,
  action  TEXT NOT NULL DEFAULT 'map-fetch',
  ts      INTEGER NOT NULL,
  period  TEXT NOT NULL                  -- 'YYYY-MM' for quick monthly counts
);
CREATE INDEX IF NOT EXISTS idx_usage_key_period ON usage (key, period);
