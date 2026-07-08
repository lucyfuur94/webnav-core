import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SnapshotDiff } from '../explorer/diff.js';
import type { ElementFingerprint } from '../playwright/fingerprint.js';
import { dbPath } from '../paths.js';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export interface DeclaredLink { to: string; via: string; }
export interface Observation { url: string; fingerprint: string[]; declaredLinks: DeclaredLink[]; }
export interface StoredObservation extends Observation { seq: number; capturedAt: number; }

export interface ActionRef {
  role: string; name: string | null; ref: string | null;
  elementFp?: ElementFingerprint | null;  // durable key recovered from the clicked node (role+name+near);
                                          // carried into graph-analyse → graph-edit so authored maps get fingerprints
  value?: string;   // the supplied VARIABLE (typed text / chosen option) for NON-SECRET inputs —
                    // makes a recorded flow re-runnable with different values; secrets never captured
}
export interface ActionEffect {
  fromUrl: string; fromSnapshot: string;
  action: ActionRef | null;
  toUrl: string; toSnapshot: string;
  navigated: boolean; diff: SnapshotDiff;
}
export interface StoredActionEffect extends ActionEffect { seq: number; capturedAt: number; }

export interface RecordSessionInfo {
  sessionId: string; active: boolean; startedAt: number; stoppedAt: number | null;
  steps: number; site: string | null;
}

/** Persists raw page observations per record-session. Sibling of MapStore;
 *  same Database handle, separate tables. No clustering here — that's analyse. */
export class RecordStore {
  private db: Database.Database;
  constructor(path = dbPath()) {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }
  static fromDatabase(db: Database.Database): RecordStore {
    const s = Object.create(RecordStore.prototype) as RecordStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    (s as any).migrate();
    return s;
  }

  private migrate(): void {
    const cols: any[] = this.db.prepare('PRAGMA table_info(record_observations)').all();
    const have = new Set(cols.map((c) => c.name));
    for (const [col, type] of [['from_url', 'TEXT'], ['from_snapshot', 'TEXT'], ['action', 'TEXT'],
      ['to_url', 'TEXT'], ['to_snapshot', 'TEXT'], ['navigated', 'INTEGER'], ['diff', 'TEXT']] as const) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE record_observations ADD COLUMN ${col} ${type}`);
    }
  }

  start(sessionId: string, nowMs = Date.now()): string {
    this.db.prepare(
      `INSERT INTO record_sessions (session_id,active,started_at) VALUES (?,1,?)
       ON CONFLICT(session_id) DO UPDATE SET active=1, started_at=?, stopped_at=NULL`)
      .run(sessionId, nowMs, nowMs);
    return sessionId;
  }
  stop(sessionId: string, nowMs = Date.now()): void {
    this.db.prepare('UPDATE record_sessions SET active=0, stopped_at=? WHERE session_id=?')
      .run(nowMs, sessionId);
  }
  /** Drop all buffered observations for a session (so re-recording into the same
   *  session id replaces, not appends — the ingest receiver's default session is reused). */
  clearSession(sessionId: string): void {
    this.db.prepare('DELETE FROM record_observations WHERE session_id=?').run(sessionId);
  }
  /** Delete a recording ENTIRELY — observations AND the session row (live finding:
   *  clearSession alone left the row, so a "deleted" recording stayed in the list). */
  deleteSession(sessionId: string): void {
    this.clearSession(sessionId);
    this.db.prepare('DELETE FROM record_sessions WHERE session_id=?').run(sessionId);
  }
  isActive(sessionId: string): boolean {
    const r: any = this.db.prepare('SELECT active FROM record_sessions WHERE session_id=?').get(sessionId);
    return !!r && r.active === 1;
  }
  append(sessionId: string, obs: Observation, nowMs = Date.now()): void {
    if (!this.isActive(sessionId)) return; // recording off → no-op
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_observations WHERE session_id=?').get(sessionId);
    this.db.prepare(
      `INSERT INTO record_observations (session_id,seq,url,fingerprint,declared_links,captured_at)
       VALUES (?,?,?,?,?,?)`)
      .run(sessionId, seq.c, obs.url, JSON.stringify(obs.fingerprint),
        JSON.stringify(obs.declaredLinks), nowMs);
  }
  observations(sessionId: string): StoredObservation[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM record_observations WHERE session_id=? ORDER BY seq').all(sessionId);
    return rows.map((r) => ({ url: r.url, fingerprint: JSON.parse(r.fingerprint),
      declaredLinks: JSON.parse(r.declared_links), seq: r.seq, capturedAt: r.captured_at }));
  }
  appendActionEffect(sessionId: string, fx: ActionEffect, nowMs = Date.now()): void {
    if (!this.isActive(sessionId)) return;
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_observations WHERE session_id=?').get(sessionId);
    this.db.prepare(
      `INSERT INTO record_observations
        (session_id,seq,url,fingerprint,declared_links,captured_at,
         from_url,from_snapshot,action,to_url,to_snapshot,navigated,diff)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sessionId, seq.c,
        fx.toUrl, '[]', '[]', nowMs,
        fx.fromUrl, fx.fromSnapshot, JSON.stringify(fx.action),
        fx.toUrl, fx.toSnapshot, fx.navigated ? 1 : 0, JSON.stringify(fx.diff));
  }
  actionEffects(sessionId: string): StoredActionEffect[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM record_observations WHERE session_id=? AND from_snapshot IS NOT NULL ORDER BY seq').all(sessionId);
    return rows.map((r) => ({
      fromUrl: r.from_url, fromSnapshot: r.from_snapshot,
      action: JSON.parse(r.action), toUrl: r.to_url, toSnapshot: r.to_snapshot,
      navigated: r.navigated === 1, diff: JSON.parse(r.diff),
      seq: r.seq, capturedAt: r.captured_at,
    }));
  }
  listSessions(): RecordSessionInfo[] {
    const rows: any[] = this.db.prepare(
      `SELECT s.session_id, s.active, s.started_at, s.stopped_at,
        (SELECT COUNT(*) FROM record_observations o
          WHERE o.session_id = s.session_id AND o.from_snapshot IS NOT NULL) AS steps,
        (SELECT o2.from_url FROM record_observations o2
          WHERE o2.session_id = s.session_id AND o2.from_snapshot IS NOT NULL
          ORDER BY o2.seq LIMIT 1) AS first_url
       FROM record_sessions s ORDER BY s.started_at DESC`).all();
    const hostOf = (u: string | null) => { try { return u ? new URL(u).host : null; } catch { return null; } };
    return rows.map((r) => ({ sessionId: r.session_id, active: r.active === 1,
      startedAt: r.started_at, stoppedAt: r.stopped_at ?? null, steps: r.steps, site: hostOf(r.first_url) }));
  }
}
