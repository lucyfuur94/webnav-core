// The interactive long-lived agent session loop. ONE process owns the browser
// start-to-finish: it opens, starts video + recording, then reads JSON-line
// commands on stdin, executes each against the SAME open browser, and writes one
// JSON result line per command. On quit/EOF it stops video (saves the take),
// stops recording, and closes the browser. This is the ONLY shape that lets video
// span the whole session (playwright-cli video is bound to one process) AND leaks
// nothing (the process closes its own browser on exit).
//
// Pure core: deps injected (adapter, store, io, notify, video) so it's unit-tested
// with scripted stdin + a fake adapter — no real browser.
import { runActionRecorded } from '../router/browse.js';
import type { ActionEffect } from '../mapstore/record.js';

export interface AgentSessionCmd {
  cmd: 'navigate' | 'snapshot' | 'click' | 'type' | 'eval' | 'quit';
  url?: string; ref?: string; text?: string; js?: string;
}

export interface AgentSessionDeps {
  sessionId: string;
  adapter: {
    open(url: string): Promise<unknown>;
    goto(url: string): Promise<unknown>;
    snapshot(): Promise<string>;
    currentUrl(): Promise<string>;
    fill(ref: string, text: string): Promise<unknown>;
    act(ref: string): Promise<unknown>;
    evalJs(js: string): Promise<string>;
    close(): Promise<unknown>;
  };
  store: {
    isActive(s: string): boolean;
    appendActionEffect(s: string, fx: ActionEffect): void;
  };
  // recover an element fingerprint from a snapshot for a ref (durable click key)
  recover: (snapshot: string, ref: string) => { action: { role: string; name: string | null; ref: string; elementFp?: unknown } };
  // read the next command line (null = EOF → quit), write one result line
  readLine: () => Promise<string | null>;
  write: (line: string) => void;
  // realtime hooks (best-effort): fired after each recorded step / on notable events
  notify: (kind: 'step' | 'sessions' | 'log', line?: string) => void;
  // video lifecycle (start after open, stop before close) — returns saved file or null
  startVideo: () => Promise<void>;
  stopVideo: () => Promise<string | null>;
  startUrl: string;
}

/** Run the interactive loop until quit/EOF. Returns a summary. */
export async function runAgentSession(deps: AgentSessionDeps): Promise<{ steps: number; video: string | null }> {
  let steps = 0;
  let video: string | null = null;
  const out = (obj: unknown) => deps.write(JSON.stringify(obj));

  // open + video + first navigate is the caller's job (it built the adapter); here we
  // assume the browser is open at startUrl. Start video now so it spans everything.
  await deps.startVideo().catch(() => {});
  deps.notify('sessions', 'agent session started: ' + deps.sessionId);
  out({ ok: true, ready: true, session: deps.sessionId, url: deps.startUrl });

  try {
    for (;;) {
      const line = await deps.readLine();
      if (line === null) break;                    // EOF → teardown
      const trimmed = line.trim();
      if (!trimmed) continue;
      let c: AgentSessionCmd;
      try { c = JSON.parse(trimmed) as AgentSessionCmd; }
      catch { out({ ok: false, error: 'invalid JSON command' }); continue; }

      if (c.cmd === 'quit') break;

      try {
        if (c.cmd === 'navigate') {
          if (!c.url) { out({ ok: false, error: 'navigate needs url' }); continue; }
          const fromUrl = await deps.adapter.currentUrl().catch(() => '');
          const fromSnapshot = fromUrl ? await deps.adapter.snapshot().catch(() => '') : '';
          await deps.adapter.goto(c.url);
          const toSnapshot = await deps.adapter.snapshot();
          const toUrl = await deps.adapter.currentUrl();
          if (deps.store.isActive(deps.sessionId)) {
            deps.store.appendActionEffect(deps.sessionId, {
              fromUrl: fromUrl || c.url, fromSnapshot, action: null,
              toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] },
            });
            steps++; deps.notify('step', 'agent nav: ' + toUrl);
          }
          out({ ok: true, url: toUrl });
        } else if (c.cmd === 'snapshot') {
          out({ ok: true, snapshot: await deps.adapter.snapshot() });
        } else if (c.cmd === 'click' || c.cmd === 'type') {
          if (!c.ref) { out({ ok: false, error: c.cmd + ' needs ref' }); continue; }
          const fromSnapshot = await deps.adapter.snapshot();
          const fromUrl = await deps.adapter.currentUrl();
          const { action } = deps.recover(fromSnapshot, c.ref);
          const r = await runActionRecorded({
            sessionId: deps.sessionId, recordStore: deps.store as never,
            fromUrl, fromSnapshot, action: action as never,
            text: c.cmd === 'type' ? c.text : undefined,
            adapter: deps.adapter as never,
          });
          if (r.status === 'failed') { out({ ok: false, error: r.reason }); continue; }
          if (r.recorded) { steps++; deps.notify('step', 'agent ' + c.cmd + ': ' + (action.name ?? c.ref)); }
          out({ ok: true, navigated: r.navigated });
        } else if (c.cmd === 'eval') {
          if (!c.js) { out({ ok: false, error: 'eval needs js' }); continue; }
          out({ ok: true, result: await deps.adapter.evalJs(c.js) });
        } else {
          out({ ok: false, error: 'unknown cmd: ' + String((c as { cmd?: string }).cmd) });
        }
      } catch (e) {
        out({ ok: false, error: String((e as Error).message ?? e) });
      }
    }
  } finally {
    // teardown IN THIS PROCESS: stop video (must happen while the session is open),
    // then close the browser. Order matters — video-stop after close saves nothing.
    video = await deps.stopVideo().catch(() => null);
    await deps.adapter.close().catch(() => {});
    deps.notify('sessions', 'agent session ended: ' + deps.sessionId + (video ? ' (video saved)' : ''));
  }
  out({ ok: true, done: true, steps, video });
  return { steps, video };
}
