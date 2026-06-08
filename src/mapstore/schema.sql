CREATE TABLE IF NOT EXISTS states (
  id TEXT PRIMARY KEY, node_id TEXT, semantic_name TEXT NOT NULL, url_pattern TEXT NOT NULL,
  role TEXT NOT NULL, available_signals TEXT NOT NULL, fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_state TEXT NOT NULL, to_state TEXT NOT NULL, semantic_step TEXT NOT NULL,
  selector_cache TEXT, kind TEXT NOT NULL, accepts_input TEXT,
  cost REAL NOT NULL DEFAULT 0, reliability REAL NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0,
  last_verified INTEGER, confidence REAL NOT NULL DEFAULT 1,
  UNIQUE(from_state, to_state, semantic_step)
);
CREATE TABLE IF NOT EXISTS goals (
  name TEXT PRIMARY KEY, site TEXT, entry TEXT, extractor TEXT,
  visit TEXT NOT NULL, surface TEXT NOT NULL, candidate_limit INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, home_url TEXT NOT NULL, capabilities TEXT NOT NULL, topics TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node TEXT NOT NULL, to_node TEXT NOT NULL, kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1, last_verified INTEGER, confidence REAL NOT NULL DEFAULT 1,
  UNIQUE(from_node, to_node, kind)
);
CREATE TABLE IF NOT EXISTS record_sessions (
  session_id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL, stopped_at INTEGER
);
CREATE TABLE IF NOT EXISTS record_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  url TEXT NOT NULL, fingerprint TEXT NOT NULL, declared_links TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  from_url TEXT, from_snapshot TEXT, action TEXT, to_url TEXT, to_snapshot TEXT,
  navigated INTEGER, diff TEXT,
  UNIQUE(session_id, seq)
);
CREATE TABLE IF NOT EXISTS walk_sessions (
  session_id TEXT PRIMARY KEY,
  start_state TEXT NOT NULL, goal_state TEXT NOT NULL,
  path TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0,
  browser_session TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paused',
  created_at INTEGER NOT NULL
);
