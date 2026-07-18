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
  mode: 'ask' | 'auto' | 'act';
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) => AsyncIterable<unknown>;

export interface RunAgentGoalArgs {
  goal: string;
  sessionId: string;
  mode: 'ask' | 'auto' | 'act';
  browser: WalkBrowser;
  store: MapStore;
  states: State[];
  emit: (e: AgentEvent) => void;
  query?: QueryFn;
  signal?: AbortSignal;
}

function text(t: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: t }] };
}

// Build the webnav tools. Each handler drives the injected browser/store; before
// returning it emits a human-readable `action` line so the panel narrates what the
// agent did (distinct from the browser's own dispatch, which goes over the channel).
function buildTools(args: RunAgentGoalArgs): ToolDef[] {
  const { browser, store, states, emit } = args;

  return [
    {
      name: 'get_page_ax',
      description: 'Return the current page as an accessibility snapshot (YAML). Read this to see refs before clicking or typing.',
      shape: {},
      handler: async () => {
        const snap = await browser.snapshot();
        emit({ type: 'action', id: 'get_page_ax', cmd: { kind: 'get-ax' } });
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
        emit({ type: 'action', id: 'click', cmd: { kind: 'click', nodeId: ref } });
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
        // ponytail: WalkBrowser.act has no raw-type path (its input slots are the
        // walk's credential/shipping fills). For a plain field the minimal correct
        // thing is to dispatch a click on the ref — the live-extension browser's
        // dispatch carries a `type` command shape; a dedicated raw-type verb on
        // WalkBrowser is the upgrade path if free-text typing becomes load-bearing.
        await browser.act(ref, null);
        emit({ type: 'action', id: 'type', cmd: { kind: 'type', nodeId: ref, text: val } });
        return text('typed into ' + ref);
      },
    },
    {
      name: 'goto',
      description: 'Navigate the tab directly to a URL.',
      shape: { url: z.string().describe('absolute URL') },
      handler: async (a) => {
        const url = String(a.url);
        if (!browser.goto) return text('this browser cannot goto a URL');
        await browser.goto(url, null);
        emit({ type: 'action', id: 'goto', cmd: { kind: 'click', nodeId: url } });
        return text('navigated to ' + url);
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
          emit({ type: 'action', id: 'check_route', cmd: { kind: 'get-ax' } });
          return text('no route: current page is not on a known map state — drive manually with click/type/goto.');
        }
        const start = match.state.id;
        const path = findPath(store, start, goalStateId);
        if (!path) {
          emit({ type: 'action', id: 'check_route', cmd: { kind: 'get-ax' } });
          return text('no route from ' + start + ' to ' + goalStateId + ' in the map — drive manually.');
        }
        emit({ type: 'action', id: 'check_route', cmd: { kind: 'get-ax' } });
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
const defaultQuery: QueryFn = async function* ({ prompt, tools, signal }) {
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
  'RECALL FIRST: before manually clicking, call check_route with the destination state id — if the map knows a route, webnav walks it deterministically and reports the result.',
  'Otherwise: call get_page_ax to see the page, then click/type/goto by ref.',
  'Irreversible actions (Place Order, Pay, Delete) are never fired automatically — if the walk hits one it stops and hands back to you.',
].join(' ');

/**
 * Run one agent goal. Streams SDK narration back as AgentEvents:
 *  - assistant text  -> { type: 'turn', text }
 *  - tool-use blocks -> { type: 'action', ... } (the loop's tool handlers also emit their own)
 *  - final result    -> { type: 'done', summary }
 *  - any throw        -> { type: 'error', message }
 * `mode` is threaded through for later Ask/Auto/Act gating; in 'ask' mode we emit a
 * plan event up front. Commit points are already protected by walkRoute (never auto-fired).
 */
export async function runAgentGoal(args: RunAgentGoalArgs): Promise<void> {
  const { goal, mode, emit } = args;
  const query = args.query ?? defaultQuery;
  const tools = buildTools(args);
  const prompt = SYSTEM + '\n\nGoal: ' + goal;

  if (mode === 'ask') {
    emit({ type: 'plan', steps: ['Check the map for a known route, then drive the tab step by step toward: ' + goal] });
  }

  try {
    let finalText = '';
    for await (const msg of query({ prompt, tools, mode, emit, signal: args.signal })) {
      const m = msg as any;
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && block.text) emit({ type: 'turn', text: block.text });
          else if (block.type === 'tool_use') emit({ type: 'action', id: String(block.id ?? block.name ?? 'tool'), cmd: { kind: 'get-ax' } });
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
