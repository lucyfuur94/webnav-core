import { PlaywrightAdapter } from '../playwright/adapter.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { fingerprintPage, declaredLinks } from '../explorer/fingerprint-page.js';
import { diffSnapshots, didNavigate } from '../explorer/diff.js';
import type { RecordStore } from '../mapstore/record.js';
import type { ActionRef } from '../mapstore/record.js';

// Minimal structural type so these helpers accept either a real PlaywrightAdapter
// or a fake (for tests). Only the methods we use are required.
export interface BrowseAdapter {
  open(url: string): Promise<string>;
  evalJs?(func: string): Promise<string>;
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
export interface ActionRecordedResult { status: 'done' | 'failed'; recorded: boolean; navigated?: boolean; reason?: string; }

/** Perform the agent's action, capture the after-page, record an ActionEffect.
 *  webnav does NOT decide what to fire — the agent supplies `action`; we record
 *  what changed (full before/after + diff + navigated). The caller manages the
 *  browser lifecycle (an action sequence reuses the session) — we do NOT close. */
export async function runActionRecorded(args: RunActionArgs): Promise<ActionRecordedResult> {
  const adapter = args.adapter ?? newAdapter();
  try {
    if (args.action.ref) {
      if (args.text != null) await adapter.fill!(args.action.ref, args.text);
      else await adapter.act!(args.action.ref);
    }
    const toSnapshot = await adapter.snapshot!();
    const toUrl = adapter.currentUrl ? await adapter.currentUrl() : args.fromUrl;
    const navigated = didNavigate(args.fromUrl, toUrl);
    let recorded = false;
    if (args.recordStore.isActive(args.sessionId)) {
      args.recordStore.appendActionEffect(args.sessionId, {
        fromUrl: args.fromUrl, fromSnapshot: args.fromSnapshot, action: args.action,
        toUrl, toSnapshot, navigated,
        diff: diffSnapshots(parseSnapshot(args.fromSnapshot), parseSnapshot(toSnapshot)),
      });
      recorded = true;
    }
    return { status: 'done', recorded, navigated };
  } catch (e) {
    return { status: 'failed', recorded: false, reason: String(e) };
  }
}
