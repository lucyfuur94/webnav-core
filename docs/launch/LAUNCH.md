# Launch assets

Everything needed to launch webnav-core. Current prerequisites before posting anything:
1. ✅ npm package live: `@dikshanty94/webnav@0.2.1`.
2. ✅ public Git tag: `v0.2.1`.
3. The demo GIF recorded + hosted (script below) and embedded near the top of the README.
4. A second recognizable workflow recorded, so "record your own site" has a second proof.

Benchmark claims below trace to `bench/results/2026-06-13-nav-v2.md` — do NOT inflate them.

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

**On-screen caption / end card:** "One decision. Zero tokens spent re-finding the route.
The agent only decided what to buy." Then: `npm install -g @dikshanty94/webnav` + the repo URL.

**Note:** trim the real `--session`/`walk-w-` ids to `…` in captions for readability, but
the GIF should show a *real* run (don't fake the JSON).

---

## 2. Show HN post

**Title:** `Show HN: webnav – map a site once so browser agents stop re-exploring it`

**Body:**
```
Hi HN. webnav is an open-source CLI/MCP server that gives AI agents a *memory* of how
to get around a website, so they don't re-reason the same navigation on every run.

The problem: an agent driving a browser pays the same token bill every time — snapshot,
reason, click, snapshot, reason, click. For sites you hit repeatedly (internal tools,
QA flows, back-office tasks) that navigation should be remembered, not re-derived.

webnav maps a site once (the agent records it, you record it yourself, or you use the Chrome
side panel), then `webnav walk
--start X --goal G` replays the route deterministically with ZERO LLM calls inside
webnav. It pauses only at genuine forks — an in-page choice (what to buy) or an
irreversible action (Place Order, which it will NEVER auto-fire) — and hands those
back to the agent. It stores the durable *intent* of each step and self-heals the
concrete selectors when the site drifts.

It's deliberately not a browser-automation framework that decides things. It's a map:
it gets the agent to where the signals are, cheaply and reliably; the agent does all
the judgment. No LLM, no API keys, no bot-wall evasion (it detects walls and escalates,
never bypasses).

In a small saucedemo benchmark (walk vs an agent ad-hoc driving the same browser, both
on Haiku), the clean two-hop product-detail task took a median 6 agent-visible calls
with `walk` vs 18 raw, and reached the goal in 3/3 vs 2/3 trials. A four-hop checkout
task was inconclusive because agents often abandoned `walk` and drove manually. Honest
caveat: this is a small run, and the win depends on agents actually using a stable walk;
on shallow routes, the benefit can be negligible.

Zero-LLM navigation core, TypeScript, SQLite map, built on Microsoft's playwright-cli. MCP
server included. The Chrome side panel can drive the active tab, show its action trail live,
and record the run back into the map. Apache-2.0.

Repo: https://github.com/lucyfuur94/webnav-core
Try it: npm install --global @playwright/cli@latest @dikshanty94/webnav@latest

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

Built on playwright-cli, ships as a CLI + MCP server, Apache-2.0. In a small benchmark,
the clean two-hop route took a median 6 agent-visible calls with `walk` vs 18 raw
(3/3 vs 2/3 goal completion). The longer checkout task was inconclusive because agents
often fell back to manual driving. Honest: the win is on stable, repeated multi-hop
routes, not every site.

[GIF: Chrome side panel drives a tab, then a remembered `walk` replays the route]

Repo + install command in the comments. Would love feedback on whether this fits your
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
[GIF: Chrome side panel drives a tab, then a remembered `walk` replays the route]

3/ It pauses only at genuine forks:
• an in-page choice (what to buy) → agent decides
• an irreversible action (Place Order) → NEVER auto-fired, always handed back

It's a map, not a driver. The agent keeps all the judgment.

4/ It stores the durable *intent* of each step and self-heals the selectors when the
site changes. Routes survive redesigns.

5/ Benchmark (saucedemo, walk vs an agent raw-driving the same browser, both on Haiku):
on the clean product-detail route, `walk` used a median 6 agent calls vs 18 raw and
reached the goal in 3/3 vs 2/3 trials. The longer checkout route was inconclusive when
agents abandoned `walk`. Honest: the win is cost + reliability where the walk is stable
and actually used, not capability on every site.

6/ Zero-LLM. No API keys. Never evades bot-walls (detects + escalates). TypeScript,
SQLite, built on @playwright. MCP server included.

Apache-2.0, open source:
https://github.com/lucyfuur94/webnav-core
npm install --global @playwright/cli@latest @dikshanty94/webnav@latest
```

---

## 5. MCP directory submissions (passive, compounding discovery)

After npm publish, submit the server with the installed command `webnav mcp` to:
- **Smithery** (smithery.ai) — PR/registration flow.
- **Glama** (glama.ai/mcp/servers) — auto-indexes; can submit.
- **PulseMCP** (pulsemcp.com) — submission form.
- **mcp.so** — submission form.
- **modelcontextprotocol/servers** GitHub — the community list (PR to the README).
- **Awesome lists:** `punkpeye/awesome-mcp-servers`, relevant `awesome-ai-agents` lists.

Each needs: name, one-line description, the install command, and (ideally) the GIF.

---

## Checklist

- [x] package live on npm (`@dikshanty94/webnav@0.2.1`)
- [x] clean global-install smoke test passes
- [ ] Demo GIF recorded, hosted, embedded in README hero
- [ ] A second recognizable site mapped (OrangeHRM) — proves "record your own"
- [ ] Show HN posted (Tue–Thu morning ET); first comment = honest limitations
- [ ] Reddit (r/LocalLLaMA, r/ClaudeAI) posted
- [ ] X thread posted
- [ ] Submitted to 5–6 MCP directories
