import { PlaywrightAdapter } from '../playwright/adapter.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { fingerprintPage, declaredLinks } from '../explorer/fingerprint-page.js';
import { diffSnapshots, didNavigate } from '../explorer/diff.js';
import { classifyReadiness } from './readiness.js';
import { classifyAuthLanding } from './auth-status.js';
import { namelessInteractive, probeNames } from '../recorder/probe.js';
import type { RecordStore } from '../mapstore/record.js';
import type { ActionRef } from '../mapstore/record.js';
import type { State } from '../mapstore/types.js';

// Minimal structural type so these helpers accept either a real PlaywrightAdapter
// or a fake (for tests). Only the methods we use are required.
export interface BrowseAdapter {
  open(url: string): Promise<string>;
  evalJs?(func: string, ref?: string): Promise<string>;   // ref-scoped for the name-probe (X6)
  network?(): Promise<string>;
  goBack?(): Promise<string>;
  reload?(): Promise<string>;
  snapshot?(): Promise<string>;
  act?(ref: string): Promise<void>;
  // PlaywrightAdapter.fill returns the CLI output (Promise<string>); fakes return
  // void. Accept both — runActionRecorded ignores the return value.
  fill?(ref: string, text: string): Promise<string | void>;
  currentUrl?(): Promise<string>;
  close(): Promise<string>;
}

export type EvalResponse =
  | { status: 'done'; url: string; value: string }
  | { status: 'failed'; url: string; reason: string };

export type NetworkResponse =
  | { status: 'done'; url: string; requests: string }
  | { status: 'failed'; url: string; reason: string };

function newAdapter(): BrowseAdapter {
  return new PlaywrightAdapter(`browse-${Date.now()}`);
}

/** Open url, run a `() => value` JS expression in the page, return the value. */
export async function runEval(
  url: string,
  func: string,
  adapter: BrowseAdapter = newAdapter(),
): Promise<EvalResponse> {
  try {
    await adapter.open(url);
    const raw = await adapter.evalJs!(func);
    return { status: 'done', url, value: parseEvalResult(raw) };
  } catch (e) {
    return { status: 'failed', url, reason: String(e) };
  } finally {
    await adapter.close().catch(() => {});
  }
}

/**
 * playwright-cli's `eval` prints the value inside a `### Result` block followed
 * by `### Ran Playwright code` / `### Page` chrome. Extract just the value (and
 * JSON-decode it if it's a quoted scalar) so the agent gets the answer, not the
 * wrapper. Falls back to the trimmed raw output if no Result block is present
 * (e.g. a fake/bare value in tests).
 */
export function parseEvalResult(raw: string): string {
  const m = raw.match(/###\s*Result\s*\n([\s\S]*?)(?:\n###|\s*$)/);
  const body = (m ? m[1] : raw).trim();
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === 'string' ? parsed : body;
  } catch {
    return body;
  }
}

/** Open url, return the network requests the page issued (the API calls behind the DOM). */
export async function runNetwork(
  url: string,
  adapter: BrowseAdapter = newAdapter(),
): Promise<NetworkResponse> {
  try {
    await adapter.open(url);
    const requests = (await adapter.network!()).trim();
    return { status: 'done', url, requests };
  } catch (e) {
    return { status: 'failed', url, reason: String(e) };
  } finally {
    await adapter.close().catch(() => {});
  }
}

/** Bounded settle: retry while the snapshot classifies as 'loading' (3x700ms) so a
 *  client-side redirect/late render is never captured as the page (the ghost-state
 *  class of bugs). Pass `first` when the caller already took the initial snapshot.
 *  Never infinite: a permanently-loading page proceeds after 3 retries. */
export async function settleSnapshot(snap: () => Promise<string>, first?: string): Promise<string> {
  let s = first ?? await snap();
  for (let i = 0; i < 3 && classifyReadiness(s) === 'loading'; i++) {
    await new Promise((r) => setTimeout(r, 700));
    s = await snap();
  }
  return s;
}

/** X6 landing name-probe: read tooltip/aria labels off the NAMELESS icon controls of a settled
 *  landing. Returns undefined when the page is fully named (so nameHints stays absent — zero eval
 *  cost on well-named pages). Best-effort: adapter with no evalJs (a bare fake) probes nothing. */
export async function probeLanding(
  adapter: { evalJs?(js: string, ref?: string): Promise<string> },
  toSnapshot: string,
): Promise<Record<string, string> | undefined> {
  if (!adapter.evalJs) return undefined;
  const nameless = namelessInteractive(parseSnapshot(toSnapshot));
  if (nameless.length === 0) return undefined;
  const hints = await probeNames({ evalJs: adapter.evalJs.bind(adapter) }, nameless);
  return Object.keys(hints).length ? hints : undefined;
}

/** Capture + record the effect of a standalone `use navigate` (cli.ts routes here
 *  AFTER opening `url` on the adapter — caller owns the browser lifecycle and the
 *  session auto-start). Settles before reading, records requestedUrl = the url the
 *  agent ASKED for (toUrl may differ on a redirect — the draft's alias evidence).
 *  Returns toSnapshot too so the caller can classify the landing (e.g. an SSO-wall
 *  check, design item 2) without an extra playwright call. */
export async function recordNavigateEffect(
  url: string, sessionId: string, recordStore: RecordStore, adapter: BrowseAdapter,
): Promise<{ toUrl: string; toSnapshot: string }> {
  // Ledger the intent BEFORE settling (spec 2026-07-16): an un-stamped row honestly
  // reads as dropped:unprocessed in coverage if this function has no failure branch
  // of its own — the caller's try owns errors.
  const led = recordStore.appendEvent(sessionId, {
    source: 'agent', kind: 'navigate', descriptor: { cmd: 'navigate', url, fromUrl: url },
  });
  const toSnapshot = await settleSnapshot(() => adapter.snapshot!());
  const toUrl = adapter.currentUrl ? await adapter.currentUrl() : url;
  const nameHints = await probeLanding(adapter, toSnapshot);
  const stepSeq = recordStore.appendActionEffect(sessionId, {
    fromUrl: url, fromSnapshot: '', action: null,
    toUrl, toSnapshot, navigated: true,
    diff: diffSnapshots([], parseSnapshot(toSnapshot)),
    requestedUrl: url, nameHints,
  });
  if (led != null) recordStore.stampEvent(sessionId, led, stepSeq != null ? 'step:' + stepSeq : 'dropped:not-recorded');
  return { toUrl, toSnapshot };
}

export interface NavigateWallCheck { authWall: boolean; loginUrl?: string }

/** Design item 2 (`use navigate` half): classify a settled navigate landing as an
 *  SSO/login wall — SAME classifyAuthLanding oracle as `walk` and `profile-status`,
 *  applied to the TARGET url's own host + map states — with NO retry (a recording
 *  captures what actually happened, judgment-free; that's `walk`'s job). Pure
 *  composition, so it's unit-testable without a live browser. `requestedUrl` is the
 *  url the agent ASKED to navigate to (its host names the site whose map states to
 *  check against); an unparseable url honestly reports no wall (nothing to check). */
export function classifyNavigateWall(requestedUrl: string, toUrl: string, toSnapshot: string, states: State[]): NavigateWallCheck {
  let site: string;
  try { site = new URL(requestedUrl).host; } catch { return { authWall: false }; }
  const { auth, loginUrl } = classifyAuthLanding(toUrl, toSnapshot, site, states);
  return auth === 'needs-login' ? { authWall: true, loginUrl } : { authWall: false };
}

export interface SnapshotRecordedResult { status: 'done' | 'failed'; url: string; recorded: boolean; reason?: string; }

/** Open `url`, snapshot it, and (if `sessionId` is recording) append an
 *  observation. The seam that makes a webnav browse contribute to the map. */
export async function runSnapshotRecorded(
  url: string, sessionId: string, recordStore: RecordStore,
  adapter: BrowseAdapter = newAdapter(),
): Promise<SnapshotRecordedResult> {
  try {
    await adapter.open(url);
    const yml = await adapter.snapshot!();
    const nodes = parseSnapshot(yml);
    let recorded = false;
    if (recordStore.isActive(sessionId)) {
      recordStore.append(sessionId, {
        url, fingerprint: fingerprintPage(nodes), declaredLinks: declaredLinks(nodes),
      });
      recorded = true;
    }
    return { status: 'done', url, recorded };
  } catch (e) {
    return { status: 'failed', url, recorded: false, reason: String(e) };
  } finally {
    await adapter.close().catch(() => {});
  }
}

export interface RunActionArgs {
  sessionId: string;
  recordStore: RecordStore;
  fromUrl: string;
  fromSnapshot: string;
  action: ActionRef;          // the element the agent fires (its ref drives the click)
  text?: string;              // when present, the action TYPES (fill) instead of clicks
  adapter?: BrowseAdapter;
}
export interface ActionRecordedResult { status: 'done' | 'failed'; recorded: boolean; navigated?: boolean; reason?: string; stepSeq?: number | null; }

/** Perform the agent's action, capture the after-page, record an ActionEffect.
 *  webnav does NOT decide what to fire — the agent supplies `action`; we record
 *  what changed (full before/after + diff + navigated). The caller manages the
 *  browser lifecycle (an action sequence reuses the session) — we do NOT close. */
export async function runActionRecorded(args: RunActionArgs): Promise<ActionRecordedResult> {
  const adapter = args.adapter ?? newAdapter();
  // Ledger the intent BEFORE acting (spec 2026-07-16): a failed action must still be
  // on the record. NO typed text in the descriptor — this path has no secret oracle.
  const led = args.recordStore.appendEvent(args.sessionId, {
    source: 'agent', kind: args.text != null ? 'type' : 'click',
    descriptor: { cmd: args.text != null ? 'type' : 'click', ref: args.action.ref,
      role: args.action.role, name: args.action.name, url: args.fromUrl },
  });
  try {
    if (args.action.ref) {
      if (args.text != null) await adapter.fill!(args.action.ref, args.text);
      else await adapter.act!(args.action.ref);
    }
    let toSnapshot = await adapter.snapshot!();
    const toUrl = adapter.currentUrl ? await adapter.currentUrl() : args.fromUrl;
    const navigated = didNavigate(args.fromUrl, toUrl);
    // SETTLE before using the snapshot, but ONLY when the action navigated: a
    // client-side redirect/late render on the NEW page otherwise records a transient
    // shell as the page (the ghost-state class of bugs). An in-page mutate/reveal has
    // no such settledness concern — its snapshot IS the (possibly sparse) diff.
    if (navigated) toSnapshot = await settleSnapshot(() => adapter.snapshot!(), toSnapshot);
    // The clicked node's declared href = the URL the click ASKED for (observed
    // evidence, judgment-free); the settled toUrl may differ when the server
    // redirects the declared destination. Recording it lets the draft alias
    // requestedKey→settledKey. Only a real cross-page http(s) destination
    // counts: a '#'/javascript: href declares no destination, and recording one
    // would alias the FROM page onto the TO page (state-merge poison).
    let requestedUrl: string | undefined;
    if (navigated && args.action.ref) {
      const href = parseSnapshot(args.fromSnapshot).find((n) => n.ref === args.action.ref)?.url;
      if (href) {
        try {
          const abs = new URL(href, args.fromUrl);
          if (/^https?:$/.test(abs.protocol) && didNavigate(args.fromUrl, abs.href)) requestedUrl = abs.href;
        } catch { /* unparseable href → no requested url */ }
      }
    }
    let recorded = false;
    let stepSeq: number | null = null;
    if (args.recordStore.isActive(args.sessionId)) {
      stepSeq = args.recordStore.appendActionEffect(args.sessionId, {
        fromUrl: args.fromUrl, fromSnapshot: args.fromSnapshot, action: args.action,
        toUrl, toSnapshot, navigated, requestedUrl,
        diff: diffSnapshots(parseSnapshot(args.fromSnapshot), parseSnapshot(toSnapshot)),
      });
      recorded = stepSeq != null;
    }
    if (led != null) args.recordStore.stampEvent(args.sessionId, led, stepSeq != null ? 'step:' + stepSeq : 'dropped:not-recorded');
    return { status: 'done', recorded, navigated, stepSeq };
  } catch (e) {
    if (led != null) args.recordStore.stampEvent(args.sessionId, led,
      'dropped:failed:' + String((e as Error).message ?? e).slice(0, 120));
    return { status: 'failed', recorded: false, reason: String(e) };
  }
}
