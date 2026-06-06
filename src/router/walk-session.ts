import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'mapstore', 'schema.sql'), 'utf8');

export interface WalkSession {
  sessionId: string; startState: string; goalState: string;
  path: string[]; pos: number; browserSession: string; status: string;
}

/** Persists a PAUSED walk's position + the playwright session NAME (the browser
 *  itself survives across CLI processes, so we don't serialize browser state).
 *  No inputs are ever stored — credentials/form values are runtime-only. */
export class WalkSessionStore {
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }
  static fromDatabase(db: Database.Database): WalkSessionStore {
    const s = Object.create(WalkSessionStore.prototype) as WalkSessionStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    return s;
  }

  create(args: { startState: string; goalState: string; path: string[]; browserSession: string; nowMs?: number }): string {
    const id = `walk-${args.browserSession}`;
    this.db.prepare(
      `INSERT INTO walk_sessions (session_id,start_state,goal_state,path,pos,browser_session,status,created_at)
       VALUES (?,?,?,?,0,?,'paused',?)
       ON CONFLICT(session_id) DO UPDATE SET start_state=excluded.start_state, goal_state=excluded.goal_state,
         path=excluded.path, pos=0, browser_session=excluded.browser_session, status='paused', created_at=excluded.created_at`)
      .run(id, args.startState, args.goalState, JSON.stringify(args.path), args.browserSession, args.nowMs ?? Date.now());
    return id;
  }
  load(sessionId: string): WalkSession | null {
    const r: any = this.db.prepare(
      "SELECT * FROM walk_sessions WHERE session_id=? AND status='paused'").get(sessionId);
    if (!r) return null;
    return { sessionId: r.session_id, startState: r.start_state, goalState: r.goal_state,
      path: JSON.parse(r.path), pos: r.pos, browserSession: r.browser_session, status: r.status };
  }
  advance(sessionId: string, pos: number): void {
    this.db.prepare('UPDATE walk_sessions SET pos=? WHERE session_id=?').run(pos, sessionId);
  }
  close(sessionId: string): void {
    this.db.prepare("UPDATE walk_sessions SET status='done' WHERE session_id=?").run(sessionId);
  }
}
