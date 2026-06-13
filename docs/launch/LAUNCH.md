# Launch assets (draft — edit before posting)

Everything needed to launch webnav-core. Prerequisites before posting anything:
1. npm publish done (`NPM_TOKEN` secret added → `npm version` + push tag).
2. The demo GIF recorded + hosted (script below) and embedded near the top of the README.
3. OrangeHRM (or another recognizable site) mapped, so "record your own site" has a second proof.

All claims below trace to `bench/results/2026-06-13-nav.md` — do NOT inflate them.

---

## 1. Demo GIF / asciinema script

**Goal:** in ~25 seconds, show an agent travel a multi-page site with `webnav walk`,
pausing only at a real fork. The viewer should think "my agent re-does this every time —
this remembers it."

**Setup (clean terminal):**
- Big font (≥18pt), 100×30 terminal, minimal prompt (`PS1='$ '`), light-on-dark.
- Pre-seed the map + creds so the demo is the *walk*, not the recording (recording is a
  separate, longer asset). Confirm `webnav dev outline www.saucedemo.com` shows the map.
- Record with [asciinema](https://asciinema.org) (`asciinema rec`) then render to GIF with
  [agg](https://github.com/asciinema/agg), or screen-capture to GIF directly. asciinema is
  preferable — crisp text, small file, embeddable.

**The script (type these, let output settle between each):**

```console
# An agent needs the checkout total on saucedemo. It already mapped the site once.
$ webnav walk --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-overview
# → webnav logs in (creds local), lands on inventory, then PAUSES:
#   "needs-navigation: before opening the cart, fire: aff_addcart"
#   webnav won't decide WHAT to buy — that's the agent's call.

$ webnav use click e54 --session w-…     # the agent adds an item — its one decision
$ webnav walk-resume walk-w-… --ref e124 # continue past the icon-only cart link
# → { "status": "done" }  — cart → checkout form (auto-filled) → overview. Total read.
```

**On-screen caption / end card:** "4 agent calls. Zero tokens spent re-finding the route.
The agent only decided what to buy." Then: `npx @dikshanty94/webnav mcp` + the repo URL.

**Note:** trim the real `--session`/`walk-w-` ids to `…` in captions for readability, but
the GIF should show a *real* run (don't fake the JSON).

---

## 2. Show HN post

**Title:** `Show HN: webnav – a navigation memory so your AI agent stops re-exploring websites`

**Body:**
```
Hi HN. webnav is an open-source CLI/MCP server that gives AI agents a *memory* of how
to get around a website, so they don't re-reason the same navigation on every run.

The problem: an agent driving a browser pays the same token bill every time — snapshot,
reason, click, snapshot, reason, click. For sites you hit repeatedly (internal tools,
QA flows, back-office tasks) that navigation should be remembered, not re-derived.

webnav maps a site once (the agent records it, or you author it), then `webnav walk
--start X --goal G` replays the route deterministically with ZERO LLM calls inside
webnav. It pauses only at genuine forks — an in-page choice (what to buy) or an
irreversible action (Place Order, which it will NEVER auto-fire) — and hands those
back to the agent. It stores the durable *intent* of each step and self-heals the
concrete selectors when the site drifts.

It's deliberately not a browser-automation framework that decides things. It's a map:
it gets the agent to where the signals are, cheaply and reliably; the agent does all
the judgment. No LLM, no API keys, no bot-wall evasion (it detects walls and escalates,
never bypasses).

In a small saucedemo benchmark (4 multi-step checkout tasks, walk vs an agent ad-hoc
driving the same browser, both on the same model): quality tied, but the walk reached
the goal in ~4 agent-visible calls vs 16–22 manual actions, and was far more reliable —
the raw-driving agent fell into the site's login-session trap in 3 of 4 runs because it
kept rediscovering the layout, while webnav's map already knew the cart link needs a URL
jump. Honest caveat from the same benchmark: on a *simple* site, quality is a tie — the
win is cost + reliability + commit-safety, not "it can do things the agent can't."

Zero-LLM, TypeScript, SQLite map, built on Microsoft's playwright-cli. MCP server so it
drops into any MCP client. Apache-2.0.

Repo: https://github.com/lucyfuur94/webnav-core
Try it: npx @dikshanty94/webnav --help   (or add it as an MCP server)

Honest about what it's not yet: mapping a new site is still a multi-step authoring flow
(one-command `map <url>` + shareable map packs are on the roadmap), and there's one
seeded example. Feedback very welcome — especially on the walk ergonomics.
```

**HN tips:** post Tue–Thu ~8–10am ET. First comment from you should be the honest
"what it's NOT" + the roadmap — front-running the top critique earns goodwill. Reply
fast, concede real limitations, never argue the benchmark up.

---

## 3. Reddit

**r/LocalLLaMA** and **r/ClaudeAI** (also consider r/AI_Agents).

**Title:** `I built a "navigation memory" for AI agents — map a site once, then replay routes with zero LLM calls (open source)`

**Body:** (shorter, less formal than HN)
```
Agents waste a ton of tokens re-figuring-out the same websites — snapshot, reason,
click, repeat, every single run. webnav fixes that: your agent maps a site once, then
`webnav walk` replays the route deterministically (no LLM inside webnav), pausing only
at real forks (what to pick, or an irreversible button it refuses to auto-click).

Built on playwright-cli, ships as a CLI + MCP server, Apache-2.0. In a small benchmark
the walk hit a multi-step checkout goal in ~4 agent calls vs 16–22 for an agent driving
the browser ad-hoc — and didn't get lost. Honest: on simple sites quality just ties; the
win is cost + reliability + never firing a commit by accident.

[GIF]

Repo + npx one-liner in the comments. Would love feedback on whether this fits your
agent workflows.
```
Put the link in a comment if the sub down-ranks link posts.

---

## 4. X / Twitter thread

```
1/ Your AI agent re-explores the same websites every day, paying the same token bill
every time: snapshot → reason → click → snapshot → reason → click.

It should REMEMBER the route, not re-derive it. So I built webnav. 🧵

2/ webnav is a navigation *memory* for agents. Map a site once — then:

  webnav walk --start login --goal checkout

replays the whole multi-page route deterministically. Zero LLM calls inside webnav.
[GIF]

3/ It pauses only at genuine forks:
• an in-page choice (what to buy) → agent decides
• an irreversible action (Place Order) → NEVER auto-fired, always handed back

It's a map, not a driver. The agent keeps all the judgment.

4/ It stores the durable *intent* of each step and self-heals the selectors when the
site changes. Routes survive redesigns.

5/ Benchmark (saucedemo, walk vs an agent raw-driving the same browser, same model):
quality tied, but the walk reached the goal in ~4 agent calls vs 16–22 — and didn't get
lost where raw driving did 3/4 times. Honest: on simple sites the win is cost +
reliability, not capability.

6/ Zero-LLM. No API keys. Never evades bot-walls (detects + escalates). TypeScript,
SQLite, built on @playwright. MCP server included.

Apache-2.0, open source:
https://github.com/lucyfuur94/webnav-core
npx @dikshanty94/webnav --help
```

---

## 5. MCP directory submissions (passive, compounding discovery)

After npm publish, submit the server (entry: `npx -y @dikshanty94/webnav mcp`) to:
- **Smithery** (smithery.ai) — PR/registration flow.
- **Glama** (glama.ai/mcp/servers) — auto-indexes; can submit.
- **PulseMCP** (pulsemcp.com) — submission form.
- **mcp.so** — submission form.
- **modelcontextprotocol/servers** GitHub — the community list (PR to the README).
- **Awesome lists:** `punkpeye/awesome-mcp-servers`, relevant `awesome-ai-agents` lists.

Each needs: name, one-line description, the `npx` command, and (ideally) the GIF.

---

## Checklist

- [ ] `NPM_TOKEN` secret added; `npm version` + tag pushed; package live on npm
- [ ] `npx @dikshanty94/webnav --help` works from a clean machine
- [ ] Demo GIF recorded, hosted, embedded in README hero
- [ ] A second recognizable site mapped (OrangeHRM) — proves "record your own"
- [ ] Show HN posted (Tue–Thu morning ET); first comment = honest limitations
- [ ] Reddit (r/LocalLLaMA, r/ClaudeAI) posted
- [ ] X thread posted
- [ ] Submitted to 5–6 MCP directories
