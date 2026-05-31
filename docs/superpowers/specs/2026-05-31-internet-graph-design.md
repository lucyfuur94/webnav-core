# The Internet Graph — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design); building on branch `webnav-research`.

> The north-star architecture: **the internet as one clustered graph of site-nodes.**
> Until now webnav had isolated *intra-site* maps (skeletons inside GitHub,
> saucedemo, a search engine). This adds the layer *above*: an **inter-site
> graph** where every website is a node, similar sites cluster, and the agent
> navigates *between* sites. It unifies the gazetteer, provider-selection, and
> the "3 best sites" idea into one structure.

## 1. The model

```
                THE INTERNET GRAPH (inter-site)
   ┌───────────────────────────────────────────────────────────┐
   │  cluster: web-search        cluster: code/package-search   │
   │   (marginalia)──(ddg)        (github)───(pypi)──(gitlab)    │
   │        │  similarity edges        │ hyperlink/co-use edges  │
   │   cluster: weather          cluster: reviews                │
   │   (wunderground)(weather)   (yelp)──(tripadvisor)           │
   └───────────────────────────────────────────────────────────┘
        each NODE's interior = its intra-site SKELETON (already built)
```

- **Node = a website** (e.g. `github.com`, `pypi.org`, `marginalia`). A node owns an
  intra-site **skeleton** (states+edges — what we already build) as its *interior*.
- **Cluster = a neighborhood of nodes serving the same purpose** = a **capability**
  (`web-search`, `code-search`, `package-search`, `weather`, `reviews`). "Which provider
  for this request" = "which cluster, then which node(s) in it."
- **Edges between nodes** (4 kinds, all confirmed in scope — #1):
  1. **capability** — same cluster (both serve web-search). The primary edge.
  2. **hyperlink** — node A links to node B (the classic web graph; e.g. a GitHub repo links its PyPI page).
  3. **co-use** — agents that used A also used B for similar requests (LEARNED, decays — the Maps-traffic analog).
  4. **content** — sites are about similar things (declared topic tags for v1; embeddings later).
- **Seed-and-grow (#2):** we do NOT map the whole web. The graph starts from the nodes we
  actually navigate and grows: new nodes/edges added as webnav visits + as usage accrues.
  (Subsumes the parked "self-growing gazetteer".)

## 2. What the graph is FOR — the two verbs it powers (#3)

The graph's concrete job is to answer two agent questions; the intra-site skeletons answer
a third:

| Verb | Question | Layer |
|---|---|---|
| `route "<request>"` | "where should I go?" → candidate nodes/clusters + **signals** | **graph** (this spec) |
| `run <node> <goal>` | "do this on that site" → evidence bundle | intra-site skeleton (built) |
| `hop <url> --to <cluster>` | "jump to the related site" → land on the neighbor | **graph edges** (this spec) |

Agent loop: **`route` → agent decides → `run` → maybe `hop` → agent synthesizes.**

## 3. Signals, not decisions (#4 + principle #5a)

webnav **never picks the best site.** `route`/`hop` return **candidates + the mechanical
signals behind them**; the AGENT decides. Signals are all judgment-free / mechanical:
- **cluster/capability match** — which clusters serve this request (the agent names the
  capability, or it's matched on declared capability; webnav does NOT infer query intent).
- **reachability** — is the node currently up / not bot-walled (R2, deterministic).
- **usage weight** — the learned co-use/reliability weight per (cluster, node), emerged from
  usage + decaying with age (the traffic analog). webnav reports the weight; it does not
  declare a winner.
- **edge provenance** — why this candidate (same cluster / linked-from-here / co-used).

`route` returns these for each candidate; the agent ranks. This keeps #5a intact: webnav
surfaces the neighborhood + mechanical signals; the agent judges fitness.

## 4. Data model (extends MapStore)

New tables, alongside the existing states/edges/goals:
```
nodes(   id TEXT PK,            -- 'github.com'
         home_url TEXT,         -- entry URL
         capabilities TEXT,     -- JSON array of cluster names this node serves
         topics TEXT )          -- JSON array (content tags, v1 of "content similarity")

node_edges( from_node TEXT, to_node TEXT, kind TEXT,   -- capability|hyperlink|co-use|content
            weight REAL DEFAULT 1, last_verified INTEGER, confidence REAL DEFAULT 1,
            UNIQUE(from_node,to_node,kind) )
```
- A node's **interior skeleton** is the existing `states`/`edges` (state ids are already
  namespaced per site, e.g. `github:repo-detail`). The node links to its skeleton by
  convention (node id = the namespace prefix).
- **co-use** edge weight uses the SAME `recordOutcome`/`decayConfidence` machinery we built
  for intra-site edges — reused at the node level. Emerges from use, decays with age.

## 5. route / hop behavior

**`route(request, capability?)`:**
1. Determine target cluster(s): if the agent passed `capability`, use it; else match the
   request against nodes' declared `capabilities` deterministically (NO intent inference —
   if ambiguous, return candidates from multiple clusters and let the agent choose).
2. Gather candidate nodes in those clusters. For each: attach reachability (optional live
   R2 probe or last-known), usage weight, and edge provenance.
3. Return `{ candidates: [{node, cluster, home_url, weight, reachable?, why}], note }`.
   Sorted by usage weight as a *convenience ordering*, explicitly labeled "not a quality
   judgment — agent decides."

**`hop(fromUrl, toCluster|toNode)`:**
1. From the current node (derived from fromUrl), find a `node_edge` to a node in `toCluster`
   (or directly to `toNode`), preferring hyperlink edges (a real link exists) then co-use.
2. Return the target node's entry (+ how to reach it). If a hyperlink edge exists, the
   landing URL; else the target node's home_url. If no edge → `{ status:'no-edge', ... }`
   (agent can fall back to `route`).

## 6. How this reframes what's built

- **Web-search providers** (R4) = the `web-search` **cluster**. Marginalia/DDG/Brave become
  nodes in it. `route "<open question>"` surfaces the cluster; the agent picks provider(s);
  `run <provider> web-search` executes (R4's search-and-gather per node).
- **GitHub repo-search / saucedemo** = nodes with their skeletons as interiors.
- **gazetteer (`list`/`describe`)** = a projection of the graph (the nodes we know).

## 7. Scope / order

This spec is the *graph layer*. Build order (each its own increment):
- **G1** — data model (nodes + node_edges in MapStore) + seed a few nodes/clusters/edges.
- **G2** — `route` verb (cluster match + candidates + signals; CLI + unit tests).
- **G3** — `hop` verb (inter-node edge traversal; CLI + unit tests).
- **G4** — co-use weight learning (recordOutcome at node level; weight emerges/decays).
- Then the deferred R5 (resume loop) and R1 (benchmark) land on top.

## 8. Out of scope (v1 of the graph)

- Content-similarity via embeddings (use declared `topics` tags for now).
- Crawling to discover nodes (seed-and-grow from actual navigation only).
- webnav inferring query intent / picking the best node (agent's job — #5a).
- Mapping the whole web (seeded subset only).
