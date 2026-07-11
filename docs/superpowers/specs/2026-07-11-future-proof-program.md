# Future-proof program (approved 2026-07-11)

User directive: never again "identify some website doing something else and update core logic." Four phases, in order:

- **Phase 0 — subtree-templates** (spec: `2026-07-11-subtree-templates-design.md`): complete the repetition principle at its last scale before anything else — the sweep would rediscover this gap on every dashboard/grid/card site.
- **Phase 1 — structure-space research**: enumerate the web's structural vocabulary from its SOURCES — WAI-ARIA Authoring Practices patterns (~30, authoritative: they define the roles our snapshots see), major component libraries (MUI/Ant/Bootstrap/Radix/Carbon/Polaris/Lightning), page archetypes (listing/detail/funnel/auth/dashboard/feed/search/wizard/editor/settings/CRUD/docs/calendar/kanban/chat). Deliverables: **Structure Coverage Matrix** (pattern × webnav classification × axis, gaps marked) + **grammar test suite** (one synthetic a11y fixture per pattern, pinned as tests — coverage becomes testable).
- **Phase 2 — extension loop** (BEFORE the sweep, so the sweep dogfoods it): the self-learning fallback.
  - `graph-analyse` gains a structured **`unknowns` report**: each entry = minimal evidence fixture + which axes declined and why + the extension point a resolution plugs into.
  - **Pattern packs, not code**: `packs/patterns/*.json` — declarative entries mapping a structural TRIGGER (constrained predicate over ARIA roles/containment/counts; schema-lint FORBIDS hostnames/URLs/text literals so site-rules stay impossible) onto one of the core's CLOSED effect set (fold-as-instances / treat-as-overlay / treat-as-shell / value-domain / …). Deterministic data at runtime; zero-LLM preserved; reviewable.
  - **Defined agent process** (`docs/EXTENDING.md` + `dev pattern-propose` scaffold verb): unknown → author pack entry + fixture test → analyse re-run resolves it AND grammar suite stays green → pack applies locally immediately → scaffolded PR to webnav-core (pattern + fixture + evidence) for human approval.
  - Honest boundary: an unknown inexpressible in the schema = a new axis/scale → file a core-design issue with the fixture; never hack.
- **Phase 3 — live sweep**: stratified 15–25 sites (top-traffic per category + deliberately rare shapes: hash-SPA, shadow-DOM components, virtualized lists, iframe-heavy, server-rendered classics) run THROUGH the Phase-2 loop; scorecards vs the matrix; every gap becomes a pack proposal or (rarely) a core issue. Guardrails/politeness/no-walls as always; public pages only.

Sustainability contract after the program: core changes are rare, deliberate design increments; the common case is a reviewable data addition through a human-gated PR.
