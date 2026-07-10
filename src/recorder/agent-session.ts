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
import { runActionRecorded, parseEvalResult, settleSnapshot } from '../router/browse.js';
import { diffSnapshots } from '../explorer/diff.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { INSTALLER_JS, MODE_JS } from './live.js';
import type { ActionEffect } from '../mapstore/record.js';

// Paint the same REC overlay the human live-recorder uses, so an agent session's
// video also shows a recording indicator + click ripples (agent clicks go through
// playwright's real .click(), which dispatches a trusted DOM click event — that
// bubbles to INSTALLER_JS's document click listener exactly like a human click, so
// the existing ripple painter fires with NO extra eval needed here). Composed as one
// eval (install-if-missing, then paint recording=on) — mirrors TICK_JS in live.ts.
// Best-effort: a CSP page that blocks eval must not break navigation/recording.
export const OVERLAY_ON_JS = `() => { (${INSTALLER_JS})(); return (${MODE_JS(true)})(); }`;

export interface AgentSessionCmd {
  cmd: 'navigate' | 'snapshot' | 'click' | 'type' | 'hover' | 'eval' | 'quit';
  url?: string; ref?: string; text?: string; js?: string;
}

// A ref-scoped DOM read (playwright-cli `eval "(element)=>…" <ref>`) to recover a
// human-meaningful label for a NAMELESS control (icon-only buttons: expand chevron,
// favorite star, duplicate — their label lives in a tooltip/aria attribute, NOT in the
// a11y snapshot's accessible name). Zero-LLM, observe-only. Runs ONLY when the recovered
// name is empty (no cost on named elements). Best-effort: a CSP page that blocks eval
// just leaves name null. TOOLTIP-ATTR LIST is broad on purpose — libraries name the
// attribute differently (title/aria-label, data-tooltip, data-tooltip-content [react-
// tooltip], data-title, data-original-title [bootstrap]).
export const NAME_PROBE_JS = `(el) => {
  const ATTRS = ['aria-label','title','data-tooltip-content','data-tooltip','data-title','data-original-title','data-tip','aria-description'];
  const g = (n) => { if (!n || !n.getAttribute) return ''; for (const a of ATTRS) { const v = n.getAttribute(a); if (v && v.trim()) return v.trim(); } return ''; };
  let s = g(el);
  if (!s) { const t = el.querySelector && el.querySelector('svg title, title'); if (t) s = (t.textContent || '').trim(); }
  if (!s && el.getAttribute) { const lb = el.getAttribute('aria-labelledby'); if (lb) { const r = el.ownerDocument.getElementById(lb); if (r) s = (r.textContent || '').trim(); } }
  if (!s) { let n = el.parentElement, d = 0; while (n && d < 2 && !s) { s = g(n); n = n.parentElement; d++; } }
  // Last resort — the element's OWN text content. A label-less control whose text IS its
  // label: a sortable column header 'Name', or a date-range button reading 'Last 7 Days
  // (CD) : 02 Jul 2026 - 08 Jul 2026 UTC'. SINGLE-LINE only (no newline) so we never scrape
  // a whole multi-row card (the leaf-vs-container rule from live.ts); the length cap is
  // generous (120) because real button labels can be long — the final slice(0,80) still
  // bounds what we store.
  if (!s) { const own = (el.textContent || '').trim(); if (own && own.length <= 120 && !/\\n/.test(own)) s = own; }
  return (s || '').trim().slice(0, 80);
}`;

/** Pick the best label for a recorded action: the recovered accessible name if present,
 *  else the DOM-probed attribute label (tooltip/aria), else null. REJECTS a probe result
 *  that's actually a playwright-cli error blob (a stale-ref eval returns "### Error …" as
 *  a string — that must never be stored as the element's name). Pure — unit-tested. */
export function enrichName(recoveredName: string | null, probed: string | null | undefined): string | null {
  const r = (recoveredName ?? '').trim();
  if (r) return r;
  const p = (probed ?? '').trim();
  if (!p || p.startsWith('### Error') || /^Error:/.test(p)) return null;   // eval failed → no name, not the error text
  return p;
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
    hover(ref: string): Promise<unknown>;
    evalJs(js: string, ref?: string): Promise<string>;
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
          await deps.adapter.evalJs(OVERLAY_ON_JS).catch(() => {});   // best-effort: video overlay
          // SETTLE before reading url+snapshot: a client-side redirect/late render otherwise
          // records a transient URL as a page (the ghost-state class of bugs). Bounded retry.
          const toSnapshot = await settleSnapshot(() => deps.adapter.snapshot());
          const toUrl = await deps.adapter.currentUrl();
          if (deps.store.isActive(deps.sessionId)) {
            deps.store.appendActionEffect(deps.sessionId, {
              fromUrl: fromUrl || c.url, fromSnapshot, action: null,
              toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] },
              requestedUrl: c.url,
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
          // NAMELESS icon controls (expand/favorite/duplicate) have no a11y name → the
          // step would log as the page URL. Probe the element's own attributes for a
          // human label BEFORE acting (title/aria-label/svg-title/tooltip). No cost on
          // named elements. Best-effort: eval failure leaves the name as-is.
          if (!(action.name ?? '').trim()) {
            const probed = parseEvalResult(await deps.adapter.evalJs(NAME_PROBE_JS, c.ref).catch(() => ''));
            action.name = enrichName(action.name, probed);
          }
          const r = await runActionRecorded({
            sessionId: deps.sessionId, recordStore: deps.store as never,
            fromUrl, fromSnapshot, action: action as never,
            text: c.cmd === 'type' ? c.text : undefined,
            adapter: deps.adapter as never,
          });
          if (r.status === 'failed') { out({ ok: false, error: r.reason }); continue; }
          if (r.recorded) { steps++; deps.notify('step', 'agent ' + c.cmd + ': ' + (action.name ?? c.ref)); }
          if (r.navigated) await deps.adapter.evalJs(OVERLAY_ON_JS).catch(() => {});   // best-effort: video overlay (fresh page from in-page nav)
          out({ ok: true, navigated: r.navigated, name: action.name });
        } else if (c.cmd === 'hover') {
          // HOVER = reveal-on-hover menus/tooltips. A same-page action (never navigates):
          // hover the ref, snapshot the revealed state, record an ActionEffect whose diff
          // shows what the hover exposed. Marked action.hover so the kind is distinguishable.
          if (!c.ref) { out({ ok: false, error: 'hover needs ref' }); continue; }
          const fromSnapshot = await deps.adapter.snapshot();
          const fromUrl = await deps.adapter.currentUrl();
          const { action } = deps.recover(fromSnapshot, c.ref);
          if (!(action.name ?? '').trim()) {
            const probed = parseEvalResult(await deps.adapter.evalJs(NAME_PROBE_JS, c.ref).catch(() => ''));
            action.name = enrichName(action.name, probed);
          }
          await deps.adapter.hover(c.ref);
          const toSnapshot = await deps.adapter.snapshot();
          const toUrl = await deps.adapter.currentUrl();
          if (deps.store.isActive(deps.sessionId)) {
            deps.store.appendActionEffect(deps.sessionId, {
              fromUrl, fromSnapshot, action: { ...action, hover: true } as never,
              toUrl, toSnapshot, navigated: false,
              diff: diffSnapshots(parseSnapshot(fromSnapshot), parseSnapshot(toSnapshot)),
            });
            steps++; deps.notify('step', 'agent hover: ' + (action.name ?? c.ref));
          }
          out({ ok: true, name: action.name, revealed: parseSnapshot(toSnapshot).length - parseSnapshot(fromSnapshot).length });
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
