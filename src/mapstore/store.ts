import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { State, Edge, Affordance, InteriorEdge, Goal, SiteNode, NodeEdge } from './types.js';
import { makeEdge, makeNodeEdge } from './types.js';
import { dbPath } from '../paths.js';

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
  deleteEdgesFromPrefix(prefix: string): void;
  edgesFrom(fromState: string): Edge[];
  allEdges(): Edge[];
  interiorEdges(nodeId: string): InteriorEdge[];
  recordOutcome(fromState: string, toState: string, semanticStep: string, success: boolean): void;
  recordSelector(fromState: string, toState: string, semanticStep: string, selector: string): void;
  decayConfidence(nowMs?: number, halfLifeMs?: number): void;
  upsertGoal(g: Goal): void;
  getGoal(name: string): Goal | null;
  allGoals(): Goal[];
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
  constructor(path = dbPath()) {
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
    // goals: add site/entry/extractor if an older DB lacks them.
    const gcols: any[] = this.db.prepare('PRAGMA table_info(goals)').all();
    for (const col of ['site', 'entry', 'extractor']) {
      if (!gcols.some((c) => c.name === col)) {
        this.db.exec(`ALTER TABLE goals ADD COLUMN ${col} TEXT`);
      }
    }
    // edges: add requires_affordances if an older DB lacks it.
    const ecols: any[] = this.db.prepare('PRAGMA table_info(edges)').all();
    if (!ecols.some((c) => c.name === 'requires_affordances')) {
      this.db.exec('ALTER TABLE edges ADD COLUMN requires_affordances TEXT');
    }
    const scols: any[] = this.db.prepare('PRAGMA table_info(states)').all();
    if (!scols.some((c) => c.name === 'affordances')) {
      this.db.exec('ALTER TABLE states ADD COLUMN affordances TEXT');
    }
    const ecols2: any[] = this.db.prepare('PRAGMA table_info(edges)').all();
    if (!ecols2.some((c) => c.name === 'core')) {
      this.db.exec('ALTER TABLE edges ADD COLUMN core INTEGER');
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
    this.db.prepare(`INSERT INTO states (id,node_id,semantic_name,url_pattern,role,available_signals,fingerprint,affordances)
      VALUES (@id,@nodeId,@semanticName,@urlPattern,@role,@sig,@fp,@aff)
      ON CONFLICT(id) DO UPDATE SET node_id=@nodeId, semantic_name=@semanticName, url_pattern=@urlPattern,
      role=@role, available_signals=@sig, fingerprint=@fp, affordances=@aff`)
      .run({
        id: s.id, nodeId: s.nodeId, semanticName: s.semanticName, urlPattern: s.urlPattern, role: s.role,
        sig: JSON.stringify(s.availableSignals), fp: JSON.stringify(s.fingerprint),
        aff: JSON.stringify(s.affordances ?? []),
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
      (from_state,to_state,semantic_step,selector_cache,kind,accepts_input,cost,reliability,success_count,fail_count,last_verified,confidence,requires_affordances,core)
      VALUES (@fromState,@toState,@semanticStep,@selectorCache,@kind,@acceptsInput,@cost,@reliability,@successCount,@failCount,@lastVerified,@confidence,@requiresAffordances,@core)
      ON CONFLICT(from_state,to_state,semantic_step) DO UPDATE SET
      selector_cache=@selectorCache, cost=@cost, reliability=@reliability,
      success_count=@successCount, fail_count=@failCount, last_verified=@lastVerified, confidence=@confidence, requires_affordances=@requiresAffordances, core=@core`)
      .run({
        fromState: e.fromState, toState: e.toState, semanticStep: e.semanticStep,
        selectorCache: e.selectorCache, kind: e.kind, acceptsInput: e.acceptsInput,
        cost: e.cost, reliability: e.reliability, successCount: e.successCount,
        failCount: e.failCount, lastVerified: e.lastVerified, confidence: e.confidence,
        requiresAffordances: JSON.stringify(e.requiresAffordances ?? []),
        core: e.core ? 1 : 0,
      });
  }
  deleteEdgesFromPrefix(prefix: string): void {
    this.db.prepare("DELETE FROM edges WHERE from_state LIKE ? || '%'").run(prefix);
  }
  /**
   * Project a state's navigate/reveal affordances (recursing into reveal children)
   * into edges. Affordances are the SOURCE OF TRUTH; this is how the router/walk
   * see them as edges WITHOUT changing their interface (principle: edges = actions).
   * mutate/input affordances and navigate/reveal with no toState do NOT project.
   */
  private projectFromAffordances(s: State): Edge[] {
    const out: Edge[] = [];
    const walk = (affs: Affordance[]) => {
      for (const a of affs) {
        if ((a.kind === 'navigate' || a.kind === 'reveal') && a.toState) {
          out.push(makeEdge({
            fromState: s.id, toState: a.toState, semanticStep: a.semanticStep,
            selectorCache: a.selectorCache,
            kind: a.commit ? 'commit-point' : 'navigate',
            core: a.core,
            acceptsInput: a.acceptsInput,
            addressableUrl: a.addressableUrl,
            // `needs` are preconditions. When the edge also declares acceptsInput, the
            // live browser AUTO-FILLS those input affordances (credentials/shipping),
            // so they are NOT a pause-gate. Only surface `needs` as a walk gate when
            // there's no acceptsInput to satisfy them (a genuine in-page affordance the
            // agent must fire first, e.g. a real add-to-cart-before-checkout gate).
            requiresAffordances: a.acceptsInput ? [] : a.needs,
            cost: a.cost, reliability: a.reliability, successCount: a.successCount,
            failCount: a.failCount, lastVerified: a.lastVerified, confidence: a.confidence,
          }));
        }
        if (a.children) walk(a.children);
      }
    };
    walk(s.affordances ?? []);
    return out;
  }

  /** Edges leaving a state = stored edges UNION projected-from-affordances, deduped
   *  by (from,to,semanticStep) preferring the stored row (carries live reliability). */
  edgesFrom(fromState: string): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges WHERE from_state=?').all(fromState);
    const stored = rows.map(rowToEdge);
    const s = this.getState(fromState);
    if (!s) return stored;
    const have = new Set(stored.map(edgeKey));
    const projected = this.projectFromAffordances(s).filter((e) => !have.has(edgeKey(e)));
    return [...stored, ...projected];
  }
  allEdges(): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges ORDER BY from_state, to_state, semantic_step').all();
    const stored = rows.map(rowToEdge);
    const have = new Set(stored.map(edgeKey));
    const projected: Edge[] = [];
    for (const s of this.allStates()) {
      for (const e of this.projectFromAffordances(s)) {
        if (!have.has(edgeKey(e))) { have.add(edgeKey(e)); projected.push(e); }
      }
    }
    return [...stored, ...projected]
      .sort((a, b) => a.fromState.localeCompare(b.fromState)
        || a.toState.localeCompare(b.toState) || a.semanticStep.localeCompare(b.semanticStep));
  }

  /**
   * Viewer-facing projection for ONE node's interior: every navigate/reveal
   * affordance becomes an edge tagged with the affordance id that triggers it
   * (`viaAffordance`, so the UI can anchor the arrow to that row). navigate/reveal
   * with no toState emit a `dangling` stub (to=null) so the UI shows "unexplored".
   */
  interiorEdges(nodeId: string): InteriorEdge[] {
    const out: InteriorEdge[] = [];
    const seen = new Set<string>();
    const stored = new Map<string, Edge>();
    for (const e of this.allEdgesStored()) stored.set(edgeKey(e), e);
    // 1. Affordance-projected edges (the source of truth; carry viaAffordance).
    for (const s of this.statesForNode(nodeId)) {
      const walk = (affs: Affordance[]) => {
        for (const a of affs) {
          if (a.kind === 'navigate' || a.kind === 'reveal') {
            if (a.toState) {
              const live = stored.get(s.id + ' ' + a.toState + ' ' + a.semanticStep);
              out.push({ from: s.id, to: a.toState, semanticStep: a.semanticStep,
                kind: a.commit ? 'commit-point' : 'navigate', viaAffordance: a.id,
                core: a.core || (live?.core ?? false) });
              seen.add(s.id + ' ' + a.toState + ' ' + a.semanticStep);
            } else if (!(a.kind === 'reveal' && a.children && a.children.length)) {
              // A reveal that exposes children does NOT itself navigate — its CHILDREN
              // carry the real transitions, so it gets no dangling stub. Only an
              // unexplored navigate (or a childless reveal) surfaces as "unexplored".
              out.push({ from: s.id, to: null, semanticStep: a.semanticStep,
                kind: a.commit ? 'commit-point' : 'navigate', viaAffordance: a.id,
                core: false, dangling: true });
            }
          }
          if (a.children) walk(a.children);
        }
      };
      walk(s.affordances ?? []);
    }
    // 2. Stored edges with NO backing affordance (explorer/legacy/teach-written
    //    edges). They have no affordance row to anchor to → synthetic viaAffordance.
    const owned = new Set(this.statesForNode(nodeId).map((s) => s.id));
    for (const e of stored.values()) {
      if (!owned.has(e.fromState)) continue;
      if (seen.has(edgeKey(e))) continue;
      out.push({ from: e.fromState, to: e.toState, semanticStep: e.semanticStep,
        kind: e.kind, viaAffordance: 'edge:' + e.toState, core: e.core });
    }
    return out;
  }

  private allEdgesStored(): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges').all();
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

  /** SELF-HEAL write-back (principle #3): record the durable name an agent's ref
   *  resolved to on a step that deterministic resolution had MISSED, so the next
   *  walk re-resolves it without re-asking. Stored as the edge's selector_cache.
   *  A no-op if the edge isn't a stored row (a purely affordance-projected edge
   *  with no edges-table backing); upserting one here is out of scope. */
  recordSelector(fromState: string, toState: string, semanticStep: string, selector: string): void {
    const row: any = this.db.prepare(
      'SELECT id FROM edges WHERE from_state=? AND to_state=? AND semantic_step=?')
      .get(fromState, toState, semanticStep);
    if (!row) return;
    this.db.prepare('UPDATE edges SET selector_cache=? WHERE id=?').run(selector, row.id);
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
    this.db.prepare(`INSERT INTO goals (name,site,entry,extractor,visit,surface,candidate_limit)
      VALUES (@name,@site,@entry,@extractor,@visit,@surface,@candidateLimit)
      ON CONFLICT(name) DO UPDATE SET site=@site, entry=@entry, extractor=@extractor,
      visit=@visit, surface=@surface, candidate_limit=@candidateLimit`)
      .run({ name: g.name, site: g.site ?? null, entry: g.entry ?? null,
        extractor: g.extractor ?? null, visit: JSON.stringify(g.visit),
        surface: JSON.stringify(g.surface), candidateLimit: g.candidateLimit });
  }
  getGoal(name: string): Goal | null {
    const r: any = this.db.prepare('SELECT * FROM goals WHERE name=?').get(name);
    return r ? { name: r.name, site: r.site ?? null, entry: r.entry ?? null,
      extractor: r.extractor ?? null, visit: JSON.parse(r.visit),
      surface: JSON.parse(r.surface), candidateLimit: r.candidate_limit } : null;
  }
  allGoals(): Goal[] {
    const rows: any[] = this.db.prepare('SELECT * FROM goals ORDER BY name').all();
    return rows.map((r) => ({ name: r.name, site: r.site ?? null, entry: r.entry ?? null,
      extractor: r.extractor ?? null, visit: JSON.parse(r.visit),
      surface: JSON.parse(r.surface), candidateLimit: r.candidate_limit }));
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

const edgeKey = (e: Edge) => e.fromState + ' ' + e.toState + ' ' + e.semanticStep;

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
    fingerprint: JSON.parse(r.fingerprint),
    affordances: r.affordances ? JSON.parse(r.affordances) : [] };
}

function rowToEdge(r: any): Edge {
  return makeEdge({
    fromState: r.from_state, toState: r.to_state, semanticStep: r.semantic_step,
    selectorCache: r.selector_cache, kind: r.kind, acceptsInput: r.accepts_input,
    cost: r.cost, reliability: r.reliability, successCount: r.success_count,
    failCount: r.fail_count, lastVerified: r.last_verified, confidence: r.confidence,
    requiresAffordances: r.requires_affordances ? JSON.parse(r.requires_affordances) : [],
    core: r.core === 1,
  });
}
