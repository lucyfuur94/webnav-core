import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { State, Edge, Goal, SiteNode, NodeEdge } from './types.js';
import { makeEdge, makeNodeEdge } from './types.js';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

/** The data-access seam. SqliteMapStore is the only impl today; a hosted
 *  backend (Firestore/Postgres) can implement the same interface later. */
export interface IMapStore {
  transaction(fn: () => void): void;
  upsertState(s: State): void;
  getState(id: string): State | null;
  allStates(): State[];
  statesForNode(nodeId: string): State[];
  upsertEdge(e: Edge): void;
  edgesFrom(fromState: string): Edge[];
  allEdges(): Edge[];
  recordOutcome(fromState: string, toState: string, semanticStep: string, success: boolean): void;
  decayConfidence(nowMs?: number, halfLifeMs?: number): void;
  upsertGoal(g: Goal): void;
  getGoal(name: string): Goal | null;
  upsertNode(n: SiteNode): void;
  getNode(id: string): SiteNode | null;
  allNodes(): SiteNode[];
  nodesByCapability(capability: string): SiteNode[];
  upsertNodeEdge(e: NodeEdge): void;
  nodeEdgesFrom(fromNode: string): NodeEdge[];
  allNodeEdges(): NodeEdge[];
}

export class MapStore implements IMapStore {
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Open a store over an already-constructed Database handle (used by tests + migration). */
  static fromDatabase(db: Database.Database): MapStore {
    const store = Object.create(MapStore.prototype) as MapStore;
    (store as any).db = db;
    db.exec(SCHEMA);
    (store as any).migrate();
    return store;
  }

  /** Idempotent: add states.node_id if missing, backfill from the id prefix. */
  private migrate(): void {
    const cols: any[] = this.db.prepare('PRAGMA table_info(states)').all();
    const hasNodeId = cols.some((c) => c.name === 'node_id');
    if (!hasNodeId) {
      this.db.exec('ALTER TABLE states ADD COLUMN node_id TEXT');
    }
    // Backfill any rows with a NULL node_id we can resolve from the id prefix.
    const prefixToNode: Record<string, string> = { github: 'github.com', sd: 'saucedemo' };
    const rows: any[] = this.db.prepare('SELECT id FROM states WHERE node_id IS NULL').all();
    const upd = this.db.prepare('UPDATE states SET node_id=? WHERE id=?');
    for (const r of rows) {
      const prefix = String(r.id).split(':')[0];
      const node = prefixToNode[prefix];
      if (node) upd.run(node, r.id);
    }
  }

  /** Run `fn` atomically — all writes commit together or none do (no torn skeleton). */
  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  upsertState(s: State): void {
    // Explicit column names (NOT positional VALUES): on a migrated DB the
    // `node_id` column is appended LAST by ALTER TABLE, not 2nd as in fresh
    // schema. Naming the columns keeps the write correct regardless of order.
    this.db.prepare(`INSERT INTO states (id,node_id,semantic_name,url_pattern,role,available_signals,fingerprint)
      VALUES (@id,@nodeId,@semanticName,@urlPattern,@role,@sig,@fp)
      ON CONFLICT(id) DO UPDATE SET node_id=@nodeId, semantic_name=@semanticName, url_pattern=@urlPattern,
      role=@role, available_signals=@sig, fingerprint=@fp`)
      .run({
        id: s.id, nodeId: s.nodeId, semanticName: s.semanticName, urlPattern: s.urlPattern, role: s.role,
        sig: JSON.stringify(s.availableSignals), fp: JSON.stringify(s.fingerprint),
      });
  }
  getState(id: string): State | null {
    const r: any = this.db.prepare('SELECT * FROM states WHERE id=?').get(id);
    return r ? rowToState(r) : null;
  }
  allStates(): State[] {
    const rows: any[] = this.db.prepare('SELECT * FROM states ORDER BY id').all();
    return rows.map(rowToState);
  }
  statesForNode(nodeId: string): State[] {
    const rows: any[] = this.db.prepare('SELECT * FROM states WHERE node_id=? ORDER BY id').all(nodeId);
    return rows.map(rowToState);
  }

  upsertEdge(e: Edge): void {
    this.db.prepare(`INSERT INTO edges
      (from_state,to_state,semantic_step,selector_cache,kind,accepts_input,cost,reliability,success_count,fail_count,last_verified,confidence)
      VALUES (@fromState,@toState,@semanticStep,@selectorCache,@kind,@acceptsInput,@cost,@reliability,@successCount,@failCount,@lastVerified,@confidence)
      ON CONFLICT(from_state,to_state,semantic_step) DO UPDATE SET
      selector_cache=@selectorCache, cost=@cost, reliability=@reliability,
      success_count=@successCount, fail_count=@failCount, last_verified=@lastVerified, confidence=@confidence`)
      .run({
        fromState: e.fromState, toState: e.toState, semanticStep: e.semanticStep,
        selectorCache: e.selectorCache, kind: e.kind, acceptsInput: e.acceptsInput,
        cost: e.cost, reliability: e.reliability, successCount: e.successCount,
        failCount: e.failCount, lastVerified: e.lastVerified, confidence: e.confidence,
      });
  }
  edgesFrom(fromState: string): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges WHERE from_state=?').all(fromState);
    return rows.map(rowToEdge);
  }
  allEdges(): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges ORDER BY from_state, to_state, semantic_step').all();
    return rows.map(rowToEdge);
  }

  recordOutcome(fromState: string, toState: string, semanticStep: string, success: boolean): void {
    const row: any = this.db.prepare(
      'SELECT * FROM edges WHERE from_state=? AND to_state=? AND semantic_step=?')
      .get(fromState, toState, semanticStep);
    if (!row) return;
    const sc = row.success_count + (success ? 1 : 0);
    const fc = row.fail_count + (success ? 0 : 1);
    const reliability = sc / Math.max(1, sc + fc);
    this.db.prepare(`UPDATE edges SET success_count=?, fail_count=?, reliability=?,
      last_verified=?, confidence=1 WHERE id=?`)
      .run(sc, fc, reliability, Date.now(), row.id);
  }

  /** Halve confidence per `halfLifeMs` of age since last_verified. */
  decayConfidence(nowMs: number = Date.now(), halfLifeMs = 1000 * 60 * 60 * 24 * 30): void {
    const rows: any[] = this.db.prepare('SELECT * FROM edges WHERE last_verified IS NOT NULL').all();
    for (const r of rows) {
      const age = nowMs - r.last_verified;
      const confidence = Math.pow(0.5, age / halfLifeMs);
      this.db.prepare('UPDATE edges SET confidence=? WHERE id=?').run(confidence, r.id);
    }
  }

  upsertGoal(g: Goal): void {
    this.db.prepare(`INSERT INTO goals VALUES (@name,@visit,@surface,@candidateLimit)
      ON CONFLICT(name) DO UPDATE SET visit=@visit, surface=@surface, candidate_limit=@candidateLimit`)
      .run({ name: g.name, visit: JSON.stringify(g.visit),
        surface: JSON.stringify(g.surface), candidateLimit: g.candidateLimit });
  }
  getGoal(name: string): Goal | null {
    const r: any = this.db.prepare('SELECT * FROM goals WHERE name=?').get(name);
    return r ? { name: r.name, visit: JSON.parse(r.visit),
      surface: JSON.parse(r.surface), candidateLimit: r.candidate_limit } : null;
  }

  // ─── Internet graph (inter-site) — Phase 2 ─────────────────────────────────
  upsertNode(n: SiteNode): void {
    this.db.prepare(`INSERT INTO nodes VALUES (@id,@homeUrl,@capabilities,@topics)
      ON CONFLICT(id) DO UPDATE SET home_url=@homeUrl,
      capabilities=@capabilities, topics=@topics`)
      .run({
        id: n.id, homeUrl: n.homeUrl,
        capabilities: JSON.stringify(n.capabilities), topics: JSON.stringify(n.topics),
      });
  }
  getNode(id: string): SiteNode | null {
    const r: any = this.db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
    return r ? rowToNode(r) : null;
  }
  allNodes(): SiteNode[] {
    const rows: any[] = this.db.prepare('SELECT * FROM nodes ORDER BY id').all();
    return rows.map(rowToNode);
  }
  /**
   * Nodes whose `capabilities` JSON array CONTAINS the given capability. We
   * JSON-parse each row and test array membership rather than a SQL LIKE — a
   * LIKE would false-match substrings (e.g. searching 'search' would hit
   * 'web-search', 'code-search', 'repo-search' all at once). Membership is exact.
   */
  nodesByCapability(capability: string): SiteNode[] {
    return this.allNodes().filter((n) => n.capabilities.includes(capability));
  }

  upsertNodeEdge(e: NodeEdge): void {
    this.db.prepare(`INSERT INTO node_edges
      (from_node,to_node,kind,weight,last_verified,confidence)
      VALUES (@fromNode,@toNode,@kind,@weight,@lastVerified,@confidence)
      ON CONFLICT(from_node,to_node,kind) DO UPDATE SET
      weight=@weight, last_verified=@lastVerified, confidence=@confidence`)
      .run({
        fromNode: e.fromNode, toNode: e.toNode, kind: e.kind,
        weight: e.weight, lastVerified: e.lastVerified, confidence: e.confidence,
      });
  }
  nodeEdgesFrom(fromNode: string): NodeEdge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM node_edges WHERE from_node=?').all(fromNode);
    return rows.map(rowToNodeEdge);
  }
  /** ALL node edges (the export/visualization needs every edge, not just from one node). */
  allNodeEdges(): NodeEdge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM node_edges').all();
    return rows.map(rowToNodeEdge);
  }
}

function rowToNode(r: any): SiteNode {
  return { id: r.id, homeUrl: r.home_url,
    capabilities: JSON.parse(r.capabilities), topics: JSON.parse(r.topics) };
}

function rowToNodeEdge(r: any): NodeEdge {
  return makeNodeEdge({
    fromNode: r.from_node, toNode: r.to_node, kind: r.kind,
    weight: r.weight, lastVerified: r.last_verified, confidence: r.confidence,
  });
}

function rowToState(r: any): State {
  return { id: r.id, nodeId: r.node_id, semanticName: r.semantic_name, urlPattern: r.url_pattern,
    role: r.role, availableSignals: JSON.parse(r.available_signals),
    fingerprint: JSON.parse(r.fingerprint) };
}

function rowToEdge(r: any): Edge {
  return makeEdge({
    fromState: r.from_state, toState: r.to_state, semanticStep: r.semantic_step,
    selectorCache: r.selector_cache, kind: r.kind, acceptsInput: r.accepts_input,
    cost: r.cost, reliability: r.reliability, successCount: r.success_count,
    failCount: r.fail_count, lastVerified: r.last_verified, confidence: r.confidence,
  });
}
