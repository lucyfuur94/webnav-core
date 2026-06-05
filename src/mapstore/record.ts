import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export interface DeclaredLink { to: string; via: string; }
export interface Observation { url: string; fingerprint: string[]; declaredLinks: DeclaredLink[]; }
export interface StoredObservation extends Observation { seq: number; capturedAt: number; }

/** Persists raw page observations per record-session. Sibling of MapStore;
 *  same Database handle, separate tables. No clustering here — that's analyse. */
export class RecordStore {
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }
  static fromDatabase(db: Database.Database): RecordStore {
    const s = Object.create(RecordStore.prototype) as RecordStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    return s;
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
}
