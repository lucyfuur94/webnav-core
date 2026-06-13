# Map packs — import a site instead of learning it

A **map pack** is the JSON `webnav dev export-map <site>` emits: a site's full navigation
skeleton — states, typed affordances (navigate/mutate/input/reveal), and the declared domain
shadow (table columns / filters / sub-tabs) — **with NO credentials** (those stay local). It's the
unit a map travels in, so only the *first* person has to learn a site; everyone else imports.

## Use a pack

```bash
# import the map (skeleton only)
webnav dev import-map mappacks/orangehrm.mappack.json

# set YOUR login creds locally (never in the pack, never shared)
webnav dev creds set opensource-demo.orangehrmlive.com username=Admin password=admin123

# now walk it — no learning run needed
webnav walk --start opensource-demo.orangehrmlive.com:auth-login \
            --goal  opensource-demo.orangehrmlive.com:recruitment-viewcandidates
```

## Packs in this repo

| Pack | States | What it is |
|---|---|---|
| `saucedemo.mappack.json` | 7 | the seeded worked example (login → checkout-complete) |
| `orangehrm.mappack.json` | 17 | the OrangeHRM demo HR app — 11 modules, full in-page repertoire + domain shadow (16/17 states) |
| `automationexercise.mappack.json` | 11 | automationexercise.com e-commerce — products/categories/detail/cart/login/contact, 115 affordances, shadow on all 11 states |

(saucedemo is also seeded by default, so you only need to import it on a DB that's been cleared.)

## Make your own pack to share
Learn a site once (see [`../docs/LEARNING-A-SITE.md`](../docs/LEARNING-A-SITE.md)), then
`webnav dev export-map <host> > mypack.json`. Hand the pack to anyone — they `import-map` it and
set their own creds. The pack is skeleton-only; it never carries logins.
