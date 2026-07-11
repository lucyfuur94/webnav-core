import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { dbPath } from '../paths.js';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'mapstore', 'schema.sql'), 'utf8');

export interface WalkSession {
  sessionId: string; startState: string; goalState: string;
  path: string[]; pos: number; browserSession: string; status: string;
  profile?: string;
  observe: string[];        // --observe state ids from the ORIGINAL walk (survives resumes)
  observeDynamic: boolean;  // --observe-dynamic from the ORIGINAL walk (survives resumes)
  observed: string[];       // state ids whose checkpoint already fired this walk (fire-once)
  pauseKind?: string;       // the RecallResponse `status` this session paused ON — lets
                            // walk-resume reject `--continue` against a non-checkpoint pause
}

/** Persists a PAUSED walk's position + the playwright session NAME (the browser
 *  itself survives across CLI processes, so we don't serialize browser state).
 *  No inputs are ever stored — credentials/form values are runtime-only. */
export class WalkSessionStore {
  private db: Database.Database;
  constructor(path = dbPath()) {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }
  static fromDatabase(db: Database.Database): WalkSessionStore {
    const s = Object.create(WalkSessionStore.prototype) as WalkSessionStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    s.migrate();
    return s;
  }

  // profile = the named browser profile this walk is running under. Persisted so
  // walk-resume can rebuild the SAME BrowserOpts the original `walk` used (needed
  // for the fresh-session SSO-wall retry, which requires knowing the profile to
  // reopen under). Additive column, same pattern as record_sessions.profile.
  private migrate(): void {
    const cols = new Set((this.db.prepare('PRAGMA table_info(walk_sessions)').all() as any[]).map((c) => c.name));
    if (!cols.has('profile')) this.db.exec('ALTER TABLE walk_sessions ADD COLUMN profile TEXT');
    if (!cols.has('observe')) this.db.exec('ALTER TABLE walk_sessions ADD COLUMN observe TEXT');
    if (!cols.has('observe_dynamic')) this.db.exec('ALTER TABLE walk_sessions ADD COLUMN observe_dynamic INTEGER');
    if (!cols.has('observed')) this.db.exec('ALTER TABLE walk_sessions ADD COLUMN observed TEXT');
    if (!cols.has('pause_kind')) this.db.exec('ALTER TABLE walk_sessions ADD COLUMN pause_kind TEXT');
  }

  create(args: { startState: string; goalState: string; path: string[]; browserSession: string; profile?: string; nowMs?: number; observe?: string[]; observeDynamic?: boolean }): string {
    const id = `walk-${args.browserSession}`;
    this.db.prepare(
      `INSERT INTO walk_sessions (session_id,start_state,goal_state,path,pos,browser_session,status,created_at,profile,observe,observe_dynamic,observed,pause_kind)
       VALUES (?,?,?,?,0,?,'paused',?,?,?,?,?,?)
       ON CONFLICT(session_id) DO UPDATE SET start_state=excluded.start_state, goal_state=excluded.goal_state,
         path=excluded.path, pos=0, browser_session=excluded.browser_session, status='paused', created_at=excluded.created_at,
         profile=excluded.profile, observe=excluded.observe, observe_dynamic=excluded.observe_dynamic,
         observed=excluded.observed, pause_kind=excluded.pause_kind`)
      .run(id, args.startState, args.goalState, JSON.stringify(args.path), args.browserSession, args.nowMs ?? Date.now(), args.profile ?? null,
        JSON.stringify(args.observe ?? []), args.observeDynamic ? 1 : 0, JSON.stringify([]), null);
    return id;
  }
  load(sessionId: string): WalkSession | null {
    const r: any = this.db.prepare(
      "SELECT * FROM walk_sessions WHERE session_id=? AND status='paused'").get(sessionId);
    if (!r) return null;
    return { sessionId: r.session_id, startState: r.start_state, goalState: r.goal_state,
      path: JSON.parse(r.path), pos: r.pos, browserSession: r.browser_session, status: r.status,
      profile: r.profile ?? undefined,
      observe: r.observe ? JSON.parse(r.observe) : [],
      observeDynamic: !!r.observe_dynamic,
      observed: r.observed ? JSON.parse(r.observed) : [],
      pauseKind: r.pause_kind ?? undefined };
  }
  advance(sessionId: string, pos: number): void {
    this.db.prepare('UPDATE walk_sessions SET pos=? WHERE session_id=?').run(pos, sessionId);
  }
  /** Persist checkpoint fire-once state + the pause kind this call returned, so a
   *  subsequent walk-resume (a) doesn't re-fire an already-observed checkpoint and
   *  (b) can reject `--continue` unless it's actually answering a checkpoint pause. */
  setPause(sessionId: string, observed: string[], pauseKind: string): void {
    this.db.prepare('UPDATE walk_sessions SET observed=?, pause_kind=? WHERE session_id=?')
      .run(JSON.stringify(observed), pauseKind, sessionId);
  }
  /** Repoint a paused session at a DIFFERENT live browser — a wall retry (design
   *  item 2) may rotate to a brand-new session mid-walk; the session_id the agent
   *  already has (and resumes against) stays stable, only the browser it reattaches
   *  to changes. */
  rebrowser(sessionId: string, browserSession: string): void {
    this.db.prepare('UPDATE walk_sessions SET browser_session=? WHERE session_id=?').run(browserSession, sessionId);
  }
  close(sessionId: string): void {
    this.db.prepare("UPDATE walk_sessions SET status='done' WHERE session_id=?").run(sessionId);
  }
  /** browser_session ids of paused walks older than `maxAgeMs` (abandoned pauses whose live
   *  browser nothing else reaps — the ceiling pre-check closes these). */
  staleBrowserSessions(maxAgeMs: number, nowMs: number = Date.now()): string[] {
    const rows: any[] = this.db.prepare(
      "SELECT browser_session, created_at FROM walk_sessions WHERE status='paused'").all();
    return rows.filter((r) => nowMs - r.created_at >= maxAgeMs).map((r) => r.browser_session);
  }
}
