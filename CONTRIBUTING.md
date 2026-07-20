# Contributing to webnav

Thanks for your interest! webnav is **a navigation memory for AI agents** — a
deterministic, zero-LLM map of websites. Contributions, bug reports, and new site
maps are all welcome.

## Ways to contribute

- **Report a bug / request a feature** — open an issue (templates provided).
- **Fix a bug or add a feature** — PRs welcome. See "Development" below.
- **Contribute a site map / map pack** — the highest-leverage contribution.
  webnav ships with worked map packs; the project gets more useful as more safe,
  repeatable workflows are mapped. Propose a candidate with the **Contribute a site
  map** issue template, or submit a pack as described below.
- **Improve docs** — `README.md`, `docs/STATUS.md`, `CLAUDE.md`.

## Ground rules (non-negotiable, from the design)

These are settled principles — please don't submit changes that violate them:

1. **webnav contains ZERO LLM.** It is pure navigation infrastructure; all
   reasoning is offloaded to the calling agent via a call-and-response protocol.
2. **Never traverse a declared commit point** (Place Order / Pay / Delete /
   Send). Those are mapped by inference, classified by the agent, never auto-fired.
3. **Never evade bot-walls.** No proxies, fingerprint-spoofing, or CAPTCHA-bypass.
   Detect a wall/toll and escalate or route to a sanctioned door — hard line.
4. **Credentials are local-only.** They live in `~/.webnav/credentials.json`
   (chmod 600), never in the map/DB, never transmitted (including by the hosted
   route, which serves map skeletons only). Do not add code that stores or sends
   credentials anywhere else.

See `CLAUDE.md` for the full settled design and mental model.

## Contributing a map pack

Choose a stable site that you are authorized to automate. Prefer public demos,
sandboxes, or open-source applications. Do not map private systems, real purchase
flows, or a site that forbids automation.

1. Follow [`docs/LEARNING-A-SITE.md`](docs/LEARNING-A-SITE.md) to learn the site.
   Keep any credentials in your local webnav store; never put them in a pack or PR.
2. Export the skeleton-only pack:
   ```bash
   webnav dev export-map <host> > mappacks/<site>.mappack.json
   ```
3. In a clean local database, import the file and run at least one representative
   `webnav walk` route. Verify that no credentials, tokens, private URLs, or personal
   data are present in the JSON.
4. Open a focused PR containing the pack and a short addition to
   [`mappacks/README.md`](mappacks/README.md): site, state count, representative
   route, and any demo credentials only when they are already publicly documented by
   the site.

If you are unsure a site is suitable, open the site-map issue first. We would rather
review the target before anyone spends time mapping it.

## Development

```bash
git clone https://github.com/lucyfuur94/webnav-core
cd webnav-core
npm install            # Node 18, 20, or 22
npm link               # `webnav` on PATH (runs source via tsx — no build step)
npm test               # vitest (gated live e2e need WEBNAV_LIVE=1 + playwright-cli)
npx tsc --noEmit       # typecheck (strict)
```

The website + hosted API live in a separate repo (`webnav-site`); this repo is the
CLI + MCP server only.

## Pull requests

- Keep changes focused; match the surrounding code style (2-space indent, the
  existing naming).
- **Add/extend tests** for behavior changes — CI runs `tsc --noEmit` + `npm test`
  on Node 18 & 20. Green CI is required.
- Don't commit build output, `node_modules`, or `*.db` files (they're gitignored).
- Reference any related issue in the PR description.

## Releasing (maintainers)

The package publishes to npm automatically on a version tag, via
`.github/workflows/release.yml`. One-time: add an `NPM_TOKEN` repo secret (an npm
**Automation** token for the `@lucyfuur94` scope). Then:

```bash
npm version patch        # or minor / major — bumps package.json + commits + tags
git push --follow-tags   # the v* tag triggers the Release workflow
```

The workflow gates that the tag matches `package.json` version, runs typecheck +
tests, builds (`prepack`), and `npm publish --provenance --access public`. Never
`npm publish` by hand — let the tag do it, so every release is built+tested in CI.

## Reporting security issues

Please do **not** open a public issue for security problems — see
[`SECURITY.md`](SECURITY.md).
