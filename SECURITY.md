# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue:

- Use GitHub's **[Private vulnerability reporting](https://github.com/lucyfuur94/webnav/security/advisories/new)**
  (Security tab → Report a vulnerability), or
- open a minimal issue asking for a private contact channel (no details in the public issue).

We'll acknowledge as soon as we can and keep you updated on a fix.

## webnav's security posture (by design)

These are settled, load-bearing properties — a report that one of them is
violated is treated as a security bug:

- **Credentials are local-only.** Site logins are stored on the user's machine at
  `~/.webnav/credentials.json` (chmod 600). They are **never** written to the map
  database, and **never transmitted** — including by the hosted "shared knowledge"
  route, which serves map **skeletons only** (states/edges/affordances). The
  central store has no credential columns.
- **Zero LLM in webnav.** No API keys or model providers in the navigation engine;
  the hot path makes no network calls to an LLM.
- **Never traverse a declared commit point.** Irreversible actions (Place Order,
  Pay, Delete, Send) are mapped by inference and only fired after the calling
  agent explicitly classifies them — never automatically.
- **Never evade bot-walls.** No proxies, fingerprint-spoofing, or CAPTCHA-bypass.
  webnav detects a wall/toll and escalates or routes to a sanctioned door.

The hosted API key (for the optional hosted route) is stored separately at
`~/.webnav/config.json` and is **not** a credential — it gates metered access to
shared maps, nothing more.

## Supported versions

webnav is pre-1.0; security fixes land on `main`. Please test against the latest `main`.
