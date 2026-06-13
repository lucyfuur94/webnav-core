# Adoption — discoverability + distribution

Living notes on getting webnav found and used. Grounded in actual search checks (2026-06-13), not
guesswork. The core objective: agents (via their operators) discover webnav and install it.

## Discoverability reality (checked 2026-06-13)

- **webnav does NOT yet surface** for its own value prop in web search — expected at ~0 stars + youth.
- **The "memory" framing is a trap.** Searching "navigation memory for AI agents" returns the crowded
  **fact-memory** cluster (mem0, mnemon, mem0ai, Awesome-AI-Memory) — webnav looks like a weak also-ran
  there. That is the WRONG neighborhood.
- **The niche is genuinely empty in the RIGHT neighborhood.** Searching "reusable site map / walk routes
  instead of re-exploring" — a search engine explicitly returned *"this appears to be a more specific
  architectural approach that wasn't directly covered."* The token-reduction world is all **page
  compression** (HTML→Markdown, context trimming = cheaper *reading*). Nobody does **navigation memory**
  (cheaper *route-finding* by remembering it). That distinction is webnav's wedge.

**Positioning rule:** lead with **browser-automation / web-agent / token-and-step reduction**, and the
phrase **"a reusable site map, not page compression."** De-emphasize bare "memory" (pulls toward the
wrong cluster). The GitHub description was updated to this on 2026-06-13.

## Where to post (humans → which seeds agent discoverability)

Agents find tools via their operators installing them, so human distribution is the lever. Ordered by
fit; the MCP registries directly answer "agents need to find it" (webnav already ships `webnav mcp`).

### 1. MCP registries/directories — DO FIRST (the literal "where agents find tools")
- ✅ **`punkpeye/awesome-mcp-servers`** (89k★) — **PR #7998 opened 2026-06-13** (Browser Automation,
  agent fast-track `🤖🤖🤖`). Awaiting merge.
- ⏳ **Official MCP Server Registry** (`registry.modelcontextprotocol.io`) — the `modelcontextprotocol/
  servers` README list is RETIRED; servers now publish a `server.json` to the registry via its
  quickstart. This validates the package exists, so it's effectively **gated on the npm publish** —
  do it right after npm goes live (user's task). Quickstart:
  https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx
- `mcp.so`, `glama.ai/mcp`, `smithery.ai` — submit via their listing flow (some auto-index from GitHub
  topics — the `mcp`/`model-context-protocol` topics we added help here). Mostly web-form submissions
  → user-driven.
- Entry copy (used in #7998): "webnav — navigation memory: your agent walks a recorded site map
  deterministically instead of re-exploring. Zero-LLM, stdio MCP." Link the repo + the one-line config.

### 2. Curated "awesome" GitHub lists — durable searchable backlinks
- `e2b-dev/awesome-ai-agents`, `kyrolabs/awesome-agents`, `awesome-llm-tools`,
  `awesome-browser-automation`, `awesome-web-agents` (check each list's contribution rules first).

### 3. Show HN / Hacker News
- Title: "Show HN: webnav — navigation memory so AI agents stop re-exploring websites".
- Lead with the honest benchmark (3× fewer steps on a deep route) AND the honest caveat — HN rewards
  candor and punishes overclaiming. The "compression vs. navigation memory" framing is the hook.

### 4. Reddit — r/LocalLLaMA, r/AI_Agents, r/mcp, r/LLMDevs
- Same honest framing; a short transcript/GIF helps.

### 5. X / Bluesky agent-dev circles + a dev.to/blog post
- The genuinely fresh angle for a post: **"Two ways to cut a web agent's tokens: compress what it reads,
  or remember where things are. Everyone does the first. webnav does the second."**

## Repo-side moves that AID discoverability (things we control)
- ✅ GH description sharpened to the wedge (2026-06-13).
- ✅ Topics include `mcp`, `model-context-protocol`, `browser-automation`, `ai-agents` (2026-06-13).
- ✅ README hero cites the honest v2 benchmark; Quickstart leads with import-a-pack; MCP one-liner surfaced.
- TODO (heavier, design-worthy): a reproducible one-command walk-vs-raw demo so a skeptic can verify the
  3× themselves; a short demo GIF/asciinema for the social posts; a deeper 4th demo site to widen the win.

## Honest guardrail
Every post/listing must keep the benchmark caveat: the walk wins on **deep, reliably-walked** routes;
shallow routes tie. Overclaiming on HN/Reddit costs more credibility than the stars it buys.
