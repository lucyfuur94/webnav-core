# Deploying the webnav website + hosted route

This is the maintainer guide to put the site live and wire up the hosted
"shared knowledge" route. The code is all in `site/`; you connect the accounts
(Turso + Vercel + the free domain). ~20 minutes.

> **Invariant:** the hosted route serves **map skeletons only**. There is no
> credential storage anywhere in this stack — site logins live only on each
> user's machine (`~/.webnav/credentials.json`).

---

## 1. Turso (the central shared-map DB) — free

1. Create an account at <https://turso.tech> and install the CLI:
   `curl -sSfL https://get.tur.so/install.sh | bash` (or `brew install tursodatabase/tap/turso`).
2. `turso auth login`
3. Create the database + a token:
   ```bash
   turso db create webnav-maps
   turso db show webnav-maps --url           # -> TURSO_DATABASE_URL  (libsql://...)
   turso db tokens create webnav-maps        # -> TURSO_AUTH_TOKEN
   ```
4. Load the schema:
   ```bash
   turso db shell webnav-maps < site/db/schema.sql
   ```

## 2. Publish the seed map(s) into Turso

The shared map is populated from your LOCAL `~/.webnav/webnav.db` (build/seed the
sites you want to share first — saucedemo is seeded by default). Run from the repo
root so both the ROOT deps (better-sqlite3, to read the local DB) and the SITE
deps (@libsql/client, to write Turso) are available:

```bash
npm install              # root deps (better-sqlite3) — once
cd site && npm install   # site deps (@libsql/client, tsx) — once
cd ..
TURSO_DATABASE_URL="libsql://...." TURSO_AUTH_TOKEN="...." \
  node --import tsx site/scripts/publish-map.ts www.saucedemo.com
```

Add more sites as args once you've mapped them. Re-running updates them (idempotent upsert).

## 3. Vercel (site + API) — free

1. Create an account at <https://vercel.com>, **Add New → Project**, import the
   GitHub repo `lucyfuur94/webnav`.
2. **Root Directory: `site`** (important — the Next.js app lives in the subdir).
   Framework auto-detects as Next.js; build/install commands come from `site/vercel.json`.
3. Add **Environment Variables** (Production + Preview):
   - `TURSO_DATABASE_URL` = the libsql URL from step 1
   - `TURSO_AUTH_TOKEN` = the token from step 1
4. **Deploy.** You'll get a `*.vercel.app` URL — verify the pages load and
   `POST /api/keys` returns a key (see step 6).

## 4. Free domain (DigitalPlat) → Vercel

1. Claim a domain at <https://dash.domain.digitalplat.org> (e.g. `webnav.dpdns.org`).
2. In Vercel → Project → **Settings → Domains**, add `webnav.dpdns.org`. Vercel shows
   the DNS target.
3. In the DigitalPlat dashboard (or the DNS provider you pointed it at, e.g.
   Cloudflare), add the record Vercel asks for:
   - apex/subdomain → **CNAME** to `cname.vercel-dns.com` (Vercel shows the exact value).
4. Wait for DNS + Vercel's SSL to go green. Site is live on the free domain.

## 5. Point the CLI default at your domain (optional)

`src/hosted.ts` defaults `DEFAULT_API_BASE` to `https://webnav.dpdns.org`. If you
use a different domain, either edit that constant, or users set `WEBNAV_API`, or
they pass `--api`. (Most users just `webnav login <key>`.)

## 6. End-to-end smoke test

```bash
# get a free key from the live site
curl -s -X POST https://webnav.dpdns.org/api/keys | jq .key       # -> wn_live_...

# the metered map fetch (needs the key; this is what `walk --hosted` calls)
curl -s https://webnav.dpdns.org/api/maps/www.saucedemo.com \
  -H "X-Webnav-Key: wn_live_..." | jq '.node.id, (.states|length)'

# no key -> 401
curl -s -o /dev/null -w '%{http_code}\n' https://webnav.dpdns.org/api/maps/www.saucedemo.com

# the CLI hosted route, end to end
webnav login wn_live_...
webnav walk --hosted --start www.saucedemo.com:login \
            --goal www.saucedemo.com:checkout-complete
```

Confirm the request to `/api/maps/...` carries only the `X-Webnav-Key` header —
no credentials are ever sent (the walk fills logins locally from CredStore).

## Local dev

```bash
cd site
TURSO_DATABASE_URL="file:./dev.db" npm run dev   # or a real libsql URL
# seed dev.db: turso/libsql shell < db/schema.sql, then publish-map against it
```

## Costs / limits (free tiers)

- **Turso free:** 500M row reads/mo, 5GB, no pausing — ample for read-heavy map fetches.
- **Vercel Hobby:** free, non-commercial. Fine for launch + a small hosted beta; a
  revenue-generating hosted route eventually needs a paid Vercel plan (or move the API).
- Billing for paid tiers (Stripe etc.) is **not** wired yet — pricing is presented and
  usage is metered; charging is a later step.
