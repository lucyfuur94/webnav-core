# Extension snapshot-compatibility spike — FINDINGS (2026-07-18)

> Answers the one unproven gate in `2026-07-18-in-browser-extension-direction.md`:
> **can a non-playwright producer (the extension's a11y sensor) feed webnav's engine with
> stable element identity, so a map round-trips across producers?** Verdict below.
> Spike code was throwaway (gitignored `tests/tmp/spike/`); this doc is the durable record.
> Run adversarially-verified by a 7-agent workflow (2 categorizers + 4 refuters + synthesis).

## Method

- **Producer A** = playwright-cli snapshot → `parseSnapshot` → `SnapNode[]` (our maps' current
  source; mechanism = playwright's injected-JS `ariaSnapshot`).
- **Producer B** = raw CDP `Accessibility.getFullAXTree` → a small adapter → `SnapNode[]`
  (the extension-faithful sensor; an extension reaches this exact call via the `chrome.debugger`
  permission — the manifest we read had it). Mechanism = Chromium's NATIVE C++ AX tree. Pulled
  over Node-24's built-in `WebSocket`, zero new deps.
- **The test** (webnav's REAL functions, not reimplemented): mint an `ElementFingerprint`
  (role + name + `near`) from one producer via `recoverFingerprint`, resolve it against the
  OTHER producer's snapshot via `resolveByFingerprint`. Success = a map recorded one way is
  walkable the other. `ref` handles are disposable by design (#3) — identity IS the fingerprint.
- Pages: 3 local hard-case fixtures (icon-only buttons, a 3-row table with identical per-row
  Edit/Delete buttons, a login form) + saucedemo + OrangeHRM (real SPA) + github.com (112
  interactive controls — the scale/messiness stress).

## Results (honest, after fixing a harness bug + isolating confounds)

| page | interactive (A/B) | cross-resolve ok (A→B / B→A) | wrong-resolve |
|---|---|---|---|
| icons | 4 / 4 | 2 + 2 correctly-ambiguous (nameless icons) | 0 |
| table | 6 / 6 | **6 / 6** — via `near` row-anchors | 0 |
| form | 4 / 4 | 4 / 4 | 0 |
| saucedemo | 3 / 3 | 3 / 3 | 0 |
| orangehrm | 8 / 9 | 4 + 4 ambiguous; 1 role-normalization drift | 0 |
| github (matched binary+viewport) | 112 / 106 | **100 / 100**; residual = 4 text-transform + 6 nameless links | 0 |

**The single most important number: ZERO wrong-resolves across ~130 interactive nodes, two
independent a11y implementations, two Chrome versions.** The identity model never mis-resolved
cross-producer — it found the right node or honestly failed. That is webnav's core safety
property (#3, never a wrong-click) holding across producers.

The **table** result is the load-bearing positive: 6 identical role+name buttons can only
cross-resolve if `deriveNear` picks the same row anchor from both producers — it did, exactly
(Acme/Dana, Globex/Ravi, Initech/Mei → anchors "Dana"/"Globex"/"Initech" identical on A and B).
The hardest part of the identity model (near-anchoring for identical siblings) is
sensor-independent. Adversarial "near-coincidental" lens tried to break this and could not.

## What the adversarial pass corrected (I was wrong or over-confident on four things)

1. **Harness bug (fixed):** my comparator filed any unresolved nameless node as "benign
   ambiguous," even when the target had zero matches (real drift). Reclassifying with an honest
   gate moved ~6 github nodes from "benign" to drift. Numbers above are post-fix. The `ok`
   counts and the never-wrong-resolve property were always honest; only the "benign" bucket was
   inflated.
2. **Viewport = VERIFIED spike artifact.** github's biggest drift (11 nav mega-menu buttons +
   the hamburger) came from the two producers capturing at different window widths. Re-capturing
   B with a matched desktop viewport recovered them: 93/91 → **100/100**. In production one
   producer captures one live viewport, so this cannot occur. Now proven, not asserted.
3. **Text-transform = GENUINE producer divergence (not a version artifact).** playwright's
   `link "Terms"` vs native-AX `link "TERMS"` PERSISTED even after matching the Chrome binary —
   so it is the code-path difference (injected `ariaSnapshot` reads source text; native
   `getFullAXTree` applies CSS `text-transform:uppercase`, arguably the more spec-correct name).
   It is CONSISTENT within a producer, so it only affects CROSS-producer replay of
   CSS-uppercased interactive labels. URLs/near still match, so it's mitigable (name-normalize).
4. **The OrangeHRM "Yundt" node is role-normalization, not async timing** (I mislabeled it):
   playwright role `generic` vs native-AX role `link` for the same OAuth tile — a second, narrow
   genuine divergence class.

## Verdict: **GO-WITH-CONDITIONS**

The core thesis holds: element identity is sensor-independent enough that a fingerprint minted
from the extension-faithful native-AX sensor resolves correctly against a playwright map and
vice versa — 100% on clean pages and on a matched-capture 112-control real page, zero
wrong-resolves anywhere, with the near-anchor mechanism (the fragile part) working identically.
The two producers are genuinely independent implementations (verified — injected JS vs native
C++), so this is real cross-implementation evidence, not a same-engine tautology.

**Conditions before/while building the extension:**
1. **Same-producer round-trip is the robust primary path** (extension records native-AX →
   extension replays native-AX). Cross-producer (mixing a playwright-authored map with extension
   replay) carries a text-transform caveat on CSS-uppercased labels — decide a name-normalization
   policy if we want that path first-class.
2. **Build out the role map.** Only 4 of 13 interactive roles (button/link/textbox/tab) were
   exercised; checkbox/combobox/select/radio/switch/menuitem* never appeared, and CDP's native
   tokens for those differ from ARIA. Extend + test on a `<select>`/checkbox/menu page before
   trusting cross-resolve there.
3. **Match the capture viewport** (trivial; inherent to a live-page extension).
4. **Characterize the role-normalization divergence** (generic vs link — likely href-absent
   anchors).

**Still untested (a spike's honest scope limits, not blockers):** shadow DOM, same/cross-origin
iframes, canvas/`role=application` widgets, a real SPA captured MID-interaction (menu open, modal
mid-animation), scale beyond ~112 nodes, and — importantly — the extension's ACTUAL
`chrome.debugger` plumbing (the spike used raw CDP as a faithful stand-in for the AX *source*; it
did not exercise extension-side attach/permission/message plumbing). The definitive next
experiment before committing engineering: capture both producers off the SAME live page instance
via an actual extension build, and add the untested surface above.
