# Walkthrough Content Lead — Standing Brief

You own the seamlessness of the product walkthrough. The map supplies the FACTS; you supply the CRAFT. Every render must pass this bar before it ships.

## 1. Language — plain English, zero internals

- **Never show a technical identifier.** `report-list`, `_shell`, `dashboard-category`, urlPatterns, state ids — banned on screen.
- **Display names come from the product's own headings** (the map stores them: the state's heading token — "Reports", "Dashboards", "Downloads", "Help Center", "Announcements"). A state without a heading gets a composed name from its parent + role ("The report builder"), still derived from map facts, never invented.
- **Sentences, not labels, for purposes.** "Find any report by name, then open, favourite or duplicate it" — derived strictly from the page's affordances (Search input, row actions), but written like a human. Rule of derivation: every noun/verb must trace to a stored affordance, column, or filter; the GRAMMAR is yours, the FACTS are the map's.
- Voice: second person, present tense, confident, no marketing superlatives ("powerful", "seamless" — banned; the map can't prove them).

## 2. Hierarchy — not all actions are equal

Every capability card structures actions in three tiers, and the tiers LOOK different:
- **Tier 1 — the page's purpose actions** (2-3 max, large type, accent color): what you come here to do. Reports → "Create a new report", "Search". Builder → "Add dimensions & metrics", "Run".
- **Tier 2 — working actions** (smaller, grouped by theme with tiny group labels): output (Download CSV · Share · Save As/Schedule), views (Table · Charts), organization (Favourites · Owned/Shared · Standard).
- **Tier 3 — utility/chrome** (pagination, refresh, per-row templates): ONE quiet summary line ("plus per-row actions: open, favourite, duplicate, delete") or omitted. Never bulleted alongside Tier 1.
- Derivation of tiers from the map, not taste: Tier 1 = navigate-to-creation + the page's input affordances + reveal openers whose children are build-verbs; Tier 2 = remaining named reveals/mutates; Tier 3 = scope:'row'/'widget' folds + pagination-shaped labels. Document the tier mapping in code next to the data.

## 3. Framing — the product is the hero, never cropped

- Screenshots/clips render CONTAINED (fit-inside) in a device frame with uniform margin ≥48px on all sides, subtle rounded corners + shadow. **No edge of the app window may ever touch or exit the canvas.** Automated check: the frame rect must be strictly inside the safe area; add a render-time assertion.
- Source captures at 1920×1080 viewport, default zoom, sidebar in its natural state. Re-capture rather than upscale or crop-to-fit.
- Ken Burns is allowed ONLY on stills, max 4% scale drift, always fully containing the window.

## 4. Motion — show the product doing something

- **Every chapter contains at least one LIVE CLIP (≥4s) of a real interaction**: cursor visibly moves, clicks (ripple), the UI responds. Stills are for chapter titles and capability cards only.
- Clips come from webnav-recorded sessions (the recorder's pointer + click-ripple overlay is ON): scripted, one scenario per chapter, captured headless at 1920×1080.
- A clip must be self-explanatory in isolation: one intention per clip ("search for a report", "open the dimension picker"). No dead time >1.5s; trim to the action.
- Transitions between chapters: quick (300-450ms), one style used consistently; no bounce.

## 5. Structure of the video

1. Cold open (≤5s): product name + one-line what-it-is (from the map: its sections).
2. Orientation (≤10s): the global navigation, shown ONCE with a live clip of moving between two sections — not a bullet list of links.
3. One chapter per core area, each: title beat (1.5s) → live clip with caption line → capability card (tiered per §2).
4. Close (≤5s): where to learn more. Provenance line "generated from the product's webnav map" stays — small, in the close.
- Total 2:00–3:00. Nothing under 6s per chapter, nothing over 25s.

## 6. Ship gate (run before delivering any render)

- [ ] Zero technical identifiers on any frame (scrub every text layer).
- [ ] Frame-containment assertion passes on every screenshot/clip.
- [ ] Each chapter has motion; total still-time < 40% of runtime.
- [ ] Tier structure visible on every capability card (3 distinct text sizes).
- [ ] Copy audit: every claim traces to a map fact (keep the trace table in the repo).
- [ ] Watch the whole render end-to-end once; note and fix any jarring cut before delivery.
