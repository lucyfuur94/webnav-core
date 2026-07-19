import { z } from 'zod';
import type { MapStore } from '../mapstore/store.js';
import type { State } from '../mapstore/types.js';
import type { WalkBrowser } from '../router/walk.js';
import type { AgentEvent } from './server.js';
import { walkRoute } from '../router/walk.js';
import { findPath } from '../router/path.js';
import { matchState } from '../explorer/fingerprint.js';
import { parseSnapshot } from '../playwright/snapshot.js';

// The agent loop — the BRAIN of the extension sidePanel. Runs the Claude Agent SDK
// with webnav tools that drive the live tab (via the injected WalkBrowser). webnav's
// engine stays ZERO-LLM: the SDK reasons; the tools (map/walk) are judgment-free.

// A tool the loop exposes to the SDK. Shape mirrors the SDK's SdkMcpToolDefinition
// closely enough that buildSdkServer() can hand each to `tool(...)`, while the unit
// tests invoke `.handler` directly to prove routing without any network call.
export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

// MODULE SEAM. The default wraps the real SDK `query`; tests inject a fake async
// generator so the loop runs with NO network call. The fake receives the built
// tools so it can invoke a handler and prove the call routes to the browser.
export type QueryFn = (params: {
  prompt: string;
  tools: ToolDef[];
  mode: 'ask' | 'act';
  // User-selected model id (e.g. 'claude-sonnet-5'). Omitted → the SDK default.
  model?: string;
  // SDK session id to resume (Options.resume). Present → continue that conversation
  // (history + system prompt already loaded); omit → fresh conversation.
  resume?: string;
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) => AsyncIterable<unknown>;

export interface RunAgentGoalArgs {
  goal: string;
  sessionId: string;
  mode: 'ask' | 'act';
  // User-selected model id, threaded to the SDK query. Omitted → the SDK default.
  model?: string;
  browser: WalkBrowser;
  store: MapStore;
  states: State[];
  emit: (e: AgentEvent) => void;
  query?: QueryFn;
  signal?: AbortSignal;
  // Conversation continuity. `resumeSessionId` (from a prior turn) → resume that SDK
  // conversation instead of cold-starting; on a resumed turn only the new goal is sent
  // (the SDK already holds the system prompt + history). `onSdkSession` is called with
  // the SDK session id captured from the message stream, so the caller can persist it
  // and resume it on the NEXT goal in the same panel conversation.
  resumeSessionId?: string;
  onSdkSession?: (sdkSessionId: string) => void;
  // The approval gate (crit #3/#4). Resolves true=proceed / false=deny. Wired by the
  // server to a POST /api/agent/approve round-trip; the unit tests inject a fake.
  // Absent → treated as an immediate approve. Only ASK mode calls it (up front, before
  // the first drive); ACT never does. See runAgentGoal for the per-mode semantics.
  awaitApproval?: () => Promise<boolean>;
}

function text(t: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: t }] };
}

// Friendly narrate labels for the panel (crit #3b). The SDK exposes webnav's tools as
// an in-process MCP server, so tool_use block names arrive as `mcp__webnav__<tool>`;
// that raw string must never reach the user. Strip the prefix and humanize the couple
// of internal-sounding verbs (click/type/goto already read fine). The panel also strips
// defensively — this keeps the label clean at the source.
function friendlyLabel(raw: string): string {
  const name = raw.replace(/^mcp__webnav__/, '');
  const friendly: Record<string, string> = {
    check_route: 'checking the map',
    get_page_ax: 'reading the page',
    list_routes: 'listing known routes',
  };
  return friendly[name] ?? name;
}

// Build the webnav tools. Each handler drives the injected browser/store; before
// returning it emits a human-readable `narrate` line so the panel shows what the
// agent did. This is DISPLAY-ONLY — the browser's own dispatch (the real CDP
// commands) goes over the channel as `action` events (server.ts), never from here.
function buildTools(args: RunAgentGoalArgs): ToolDef[] {
  const { browser, store, states, emit } = args;

  return [
    {
      name: 'get_page_ax',
      description: 'Return the current page as an accessibility snapshot (YAML). Read this to see refs before clicking or typing.',
      shape: {},
      handler: async () => {
        const snap = await browser.snapshot();
        emit({ type: 'narrate', label: friendlyLabel('get_page_ax'), detail: 'read page' });
        return text(snap);
      },
    },
    {
      name: 'click',
      description: 'Click the element with the given ref (from get_page_ax).',
      shape: { ref: z.string().describe('element ref, e.g. e5') },
      handler: async (a) => {
        const ref = String(a.ref);
        await browser.act(ref, null);
        emit({ type: 'narrate', label: 'click', detail: ref });
        return text('clicked ' + ref);
      },
    },
    {
      name: 'type',
      description: 'Type text into the field with the given ref.',
      shape: { ref: z.string().describe('field ref'), text: z.string().describe('text to type') },
      handler: async (a) => {
        const ref = String(a.ref);
        const val = String(a.text ?? '');
        if (!browser.typeText) {
          return text('cannot type: this browser has no free-text input; field ' + ref + ' was NOT filled');
        }
        await browser.typeText(ref, val);
        emit({ type: 'narrate', label: 'type', detail: '"' + val + '" into ' + ref });
        return text('typed "' + val + '" into ' + ref);
      },
    },
    {
      name: 'goto',
      description: 'Navigate the tab directly to a URL.',
      shape: { url: z.string().describe('absolute URL') },
      handler: async (a) => {
        const url = String(a.url);
        if (!browser.goto) return text('this browser cannot goto a URL');
        // Two modes: Ask gated the whole run up front; Act drives freely. Commit points
        // (Place Order / Pay / Delete) are STILL never auto-fired — walkRoute halts on them
        // regardless of mode — so autonomy here is bounded by that hard safety floor.
        await browser.goto(url, null);
        emit({ type: 'narrate', label: 'goto', detail: url });
        return text('navigated to ' + url);
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the current page by dy pixels (positive = down, negative = up) to reveal content below or above the fold, then re-read with get_page_ax.',
      shape: { dy: z.number().describe('pixels to scroll; positive scrolls down, negative up (e.g. 600)') },
      handler: async (a) => {
        const dy = Number(a.dy);
        if (!browser.scroll) return text('this browser cannot scroll');
        await browser.scroll(dy);
        emit({ type: 'narrate', label: 'scroll', detail: (dy >= 0 ? 'down ' : 'up ') + Math.abs(dy) + 'px' });
        return text('scrolled ' + (dy >= 0 ? 'down ' : 'up ') + Math.abs(dy) + 'px');
      },
    },
    {
      name: 'list_routes',
      description:
        'List the recallable destination states webnav already knows for the CURRENT site. Call this FIRST to discover which goal state ids exist, then pass one to check_route. Returns id + name per destination.',
      shape: {},
      handler: async () => {
        // ZERO-LLM: pure filtering of the in-memory states. Current site = the nodeId of
        // whatever known state the live page matches (fingerprint-based, so account-id URL
        // differences never matter). If the page matches no state, fall back to ALL sites'
        // destinations so the agent still sees what maps exist. A real destination has a
        // NON-EMPTY fingerprint (mirrors matchState: _shell + empty-fp stubs identify nothing).
        const match = matchState(parseSnapshot(await browser.snapshot()), states);
        const site = match.status === 'matched' ? match.state.nodeId : null;
        const dests = states.filter(
          (s) => s.fingerprint.length > 0 && (site === null || s.nodeId === site),
        );
        emit({ type: 'narrate', label: friendlyLabel('list_routes'), detail: dests.length + ' destination(s)' });
        if (dests.length === 0) return text('no recallable destinations known for this site — drive manually with click/type/goto.');
        const lines = dests.map((s) => '- ' + s.id + ' — ' + s.semanticName);
        return text('known destinations (pass an id to check_route):\n' + lines.join('\n'));
      },
    },
    {
      name: 'check_route',
      description:
        'RECALL-FIRST: check whether the map already knows a deterministic route from the current page to a goal state. On a hit, webnav walks it for you and reports the result; on a miss, drive manually with click/type/goto.',
      shape: { goalStateId: z.string().describe('id of the destination state, e.g. sd:cart') },
      handler: async (a) => {
        const goalStateId = String(a.goalStateId);
        // ZERO-LLM: parse the live snapshot, match it to a known state, ask findPath.
        const nodes = parseSnapshot(await browser.snapshot());
        const match = matchState(nodes, states);
        if (match.status !== 'matched') {
          emit({ type: 'narrate', label: friendlyLabel('check_route'), detail: 'current page not on a known state' });
          return text('no route: current page is not on a known map state — drive manually with click/type/goto.');
        }
        const start = match.state.id;
        const path = findPath(store, start, goalStateId);
        if (!path) {
          emit({ type: 'narrate', label: friendlyLabel('check_route'), detail: 'no route ' + start + ' -> ' + goalStateId });
          return text('no route from ' + start + ' to ' + goalStateId + ' in the map — drive manually.');
        }
        emit({ type: 'narrate', label: friendlyLabel('check_route'), detail: path.join(' -> ') });
        // THE PAYOFF: hand the found route to the deterministic replay (walkRoute
        // UNMODIFIED), then narrate its terminal RecallResponse back to the agent.
        const res = await walkRoute({
          goalName: 'agent:' + args.goal,
          startStateId: start,
          goalStateId,
          store,
          states,
          browser,
          path,
        });
        return text('route found [' + path.join(' -> ') + ']; walked: ' + summarizeRecall(res));
      },
    },
  ];
}

// One-line summary of a walk's terminal response for the agent to read as a tool result.
function summarizeRecall(res: { status: string } & Record<string, unknown>): string {
  switch (res.status) {
    case 'done': return 'done';
    case 'needs-navigation': return 'needs-navigation at step ' + (res as any).at + ': ' + (res as any).question;
    case 'needs-classification': return 'needs-classification: ' + (res as any).action;
    case 'needs-auth': return 'needs-auth (login required) at ' + (res as any).loginUrl;
    case 'checkpoint': return 'checkpoint at ' + (res as any).state;
    case 'failed': return 'failed: ' + (res as any).reason;
    default: return res.status;
  }
}

// The default QueryFn: wire the tools into a real SDK MCP server and run query().
// Imported lazily so unit tests (which inject a fake) never load the SDK.
const defaultQuery: QueryFn = async function* ({ prompt, tools, model, resume, signal }) {
  const { tool, createSdkMcpServer, query } = await import('@anthropic-ai/claude-agent-sdk');
  const sdkTools = tools.map((t) =>
    tool(t.name, t.description, t.shape, async (a: Record<string, unknown>, extra: unknown) => t.handler(a, extra)),
  );
  const server = createSdkMcpServer({ name: 'webnav', tools: sdkTools });
  const allowedTools = tools.map((t) => 'mcp__webnav__' + t.name);
  yield* query({
    prompt,
    options: {
      mcpServers: { webnav: server },
      allowedTools,
      permissionMode: 'default',
      // Only pass `model` when the user picked one; omit → SDK default (never '').
      ...(model ? { model } : {}),
      // Continue a prior conversation (Options.resume) when a session id is carried over.
      ...(resume ? { resume } : {}),
      ...(signal ? { abortController: abortFromSignal(signal) } : {}),
    },
  });
};

// The SDK wants an AbortController; the loop is handed an AbortSignal (for /stop).
// Bridge them so aborting the signal aborts the query.
function abortFromSignal(signal: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  return ctrl;
}

const SYSTEM = [
  'You navigate a live browser tab to accomplish the user goal.',
  'RECALL FIRST: call list_routes to discover the destination state ids webnav already knows for this site, then call check_route with the relevant id — if the map knows a route, webnav walks it deterministically and reports the result. You do NOT need to guess ids; list_routes shows the real ones.',
  'Only if list_routes is empty or check_route reports no route: call get_page_ax to see the page, then drive manually with click/type/goto by ref.',
  'Irreversible actions (Place Order, Pay, Delete) are never fired automatically — if the walk hits one it stops and hands back to you.',
].join(' ');

/**
 * Run one agent goal. Streams SDK narration back as AgentEvents:
 *  - assistant text  -> { type: 'turn', text }
 *  - tool-use blocks -> { type: 'narrate', label } (display-only; the REAL CDP `action`
 *                       events come from the channel in server.ts, never from here)
 *  - final result    -> { type: 'done', summary }
 *  - any throw        -> { type: 'error', message }
 *
 * Ask/Auto/Act gate semantics (crit #3/#4 — these three are OBSERVABLY different):
 *  - ACT:  no confirmations. Drives freely. (Commit points are still protected by
 *          walkRoute's needs-classification — never auto-fired.)
 *  - AUTO: drives freely EXCEPT it pauses for approval before a goto to a NEW ORIGIN
 *          (cross-site navigation = the cheap "meaningful action" signal). Gate lives in
 *          the goto tool handler (buildTools). Same-origin driving is never gated.
 *  - ASK:  emit the plan, then BLOCK the whole run on awaitApproval() BEFORE the query's
 *          first driving tool can run. Approve → run. Deny → emit a "denied" done and
 *          return without ever starting the query (nothing drives).
 */
export async function runAgentGoal(args: RunAgentGoalArgs): Promise<void> {
  const { goal, mode, emit } = args;
  const query = args.query ?? defaultQuery;
  const tools = buildTools(args);
  // Turn 1 (fresh): send SYSTEM + goal. Resumed turn: send JUST the goal — the SDK
  // already holds the system prompt + history from the resumed session, so re-injecting
  // SYSTEM would make Claude re-orient and re-list routes every message (the whole bug).
  const prompt = args.resumeSessionId ? goal : SYSTEM + '\n\nGoal: ' + goal;

  if (mode === 'ask') {
    emit({ type: 'plan', steps: ['Check the map for a known route, then drive the tab step by step toward: ' + goal] });
    // HARD GATE: block before the first drive. The SDK query does not start until the
    // user approves — that is what makes Ask genuinely different from Auto/Act.
    const ok = args.awaitApproval ? await args.awaitApproval() : true;
    if (!ok) {
      emit({ type: 'done', summary: 'denied — nothing was done' });
      return;
    }
  }

  try {
    let finalText = '';
    let sdkSessionSeen = false;
    for await (const msg of query({ prompt, tools, mode, model: args.model, resume: args.resumeSessionId, emit, signal: args.signal })) {
      const m = msg as any;
      // Capture the SDK session id off the message stream (every SDKMessage carries it).
      // Report it ONCE so the caller can persist it and resume this conversation next turn.
      if (!sdkSessionSeen && typeof m.session_id === 'string' && m.session_id) {
        sdkSessionSeen = true;
        args.onSdkSession?.(m.session_id);
      }
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && block.text) emit({ type: 'turn', text: block.text });
          // NOTE: we deliberately do NOT narrate the tool_use block here. Each tool's
          // handler (buildTools) emits its OWN narrate with the RESULT detail (e.g.
          // "listing known routes: 46 destination(s)"); narrating the announcement too
          // produced a duplicate bare line per action. The handler narrate is the one.
        }
      } else if (m.type === 'result') {
        if (m.subtype === 'success') finalText = m.result ?? finalText;
      }
    }
    emit({ type: 'done', summary: finalText || undefined });
  } catch (e) {
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
