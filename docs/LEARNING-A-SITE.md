# Teaching webnav a website — the agent prompt

webnav doesn't crawl sites for you. **An agent drives the site once through webnav's `use`
primitives while recording**, then `graph-analyse --draft` folds that recording into a
self-verified map you persist with `graph-edit`. This doc is the **reusable prompt** to hand your
agent so it does that learning in one shot — the same prompt that learned the seeded OrangeHRM map
(login + 11 modules, exercised, in a single autonomous run).

It's deliberately model-cheap: webnav is zero-LLM navigation infra, so the *learning* agent can be a
small/cheap model (we use Haiku). The prompt's job is to make the agent **drive thoroughly and trust
the draft** — never hand-author fingerprints or URLs.

## How to use it

1. Store any login credentials first (kept local, never in the map):
   ```
   webnav dev creds set <host> username=<u> password=<p>
   ```
2. Copy the prompt below, fill the four `{{...}}` placeholders, and give it to your agent (Claude
   Code subagent, an MCP client, or any agent that can run shell commands). Let it run autonomously.
3. When it finishes, you have a persisted map. Walk it: `webnav walk --start <id> --goal <id>`.

## The prompt (fill the placeholders, then hand to your agent)

```
You are teaching a website to webnav (a zero-LLM navigation-memory CLI on your PATH as `webnav`).
This is a ONE-SHOT autonomous task: complete the whole thing, then report. There is NO follow-up.

OBJECTIVE: Build a COMPLETE map of {{SITE_NAME}} so a cheap agent can later recall routes AND know
what it can DO on each page. "Complete" = every main section reached, AND each section's page
actually EXERCISED (its in-page features used), not just visited. A map that only has the nav menu
between sections is a FAILURE.

SITE: {{START_URL}}
{{CREDENTIALS_NOTE}}   (e.g. "Credentials for host <host> are stored in webnav and auto-filled on
                         login — you never type or need them." — or "No login required.")

THE FLOW (use these exact verbs; all output is JSON on stdout):
1. `webnav dev record-start --session {{SESSION}}` — begin recording.
2. Drive the site THROUGH webnav with the `use` verbs, all `--session {{SESSION}} --headless`:
   - `webnav use navigate <url> --session {{SESSION}} --headless` — go to a URL.
   - `webnav use snapshot --session {{SESSION}}` — read the page (YAML of elements with [ref=eNN]).
     READ THIS to decide what to click/type. If it looks empty/half-rendered, snapshot AGAIN (SPA
     render race) — do not conclude the site is blocked; a blank page is almost always a transient
     race, not a wall.
   - `webnav use click --ref <eNN> --session {{SESSION}}` — click an element by its ref.
   - `webnav use type --ref <eNN> --text "<value>" --session {{SESSION}}` — type into a field.
   Every click/type is recorded with the element's durable fingerprint automatically.
3. WHAT TO DRIVE (the crux — be thorough; time does NOT matter, coverage does):
   a. Log in if needed (navigate to the login URL, click the submit button — creds auto-fill).
   b. Visit EACH main section via the site's nav. Snapshot each landing page.
   c. On each LIST / index page, EXERCISE it — fire the safe, REVERSIBLE in-page actions so they get
      recorded:
      - click "Search"/"Apply" then "Reset" (runs + clears a filter).
      - click a column header to sort.
      - click "Add"/"New"/"Create" to open the create form — then go BACK (navigate to the list url
        again). Do NOT submit/save.
      - if there's a "⋮"/row-actions/overflow menu, click it to reveal the menu, then snapshot.
      - DO NOT click Delete, Save, Submit, Confirm, Pay, Purchase, or anything irreversible. Reveal
        and observe them; never fire them.
   d. Return to the home/hub page between sections so back-edges get captured.
4. `webnav dev record-stop --session {{SESSION}}` — stop recording.
5. `webnav dev graph-analyse --session {{SESSION}} --draft` — this MECHANICALLY folds your recording
   into a SELF-VERIFIED {node,states,edges} draft (absolute URLs, unique fingerprints, in-page
   affordances, login wired, declared domain shadow). Read the JSON. Note any state with a `_warning`.
6. Persist it:
   `webnav dev graph-edit --node {{NODE_ID}} --graph '<the draft JSON from step 5>'`
   You MAY lightly rename obvious states first, but do NOT hand-author fingerprints or URLs — trust
   the draft. That self-authoring is what causes thrash; the draft already did the hard part.
7. Verify:
   `webnav dev graph-show --node {{NODE_ID}}` and `webnav dev outline {{NODE_ID}}` — confirm states
   exist with affordances of kinds beyond `navigate` (you should see mutate/input/reveal on the
   list/index pages — that's the in-page repertoire you exercised in 3c).

BROWSER HYGIENE (mandatory): use ONE session ({{SESSION}}) for everything — never open parallel
browsers. When done, run `webnav dev sessions reap --all` to close it.

REPORT BACK (final message, structured): how many states the map has + their labels; per page, the
affordance counts by kind (navigate/mutate/input/reveal); whether the in-page features were captured;
any `_warning` flags; and confirm you reaped the session.
```

## Placeholders

| Placeholder | Example |
|---|---|
| `{{SITE_NAME}}` | "the OrangeHRM demo HR app" |
| `{{START_URL}}` | `https://opensource-demo.orangehrmlive.com/web/index.php/auth/login` |
| `{{NODE_ID}}` | `opensource-demo.orangehrmlive.com` (the host) |
| `{{SESSION}}` | any name, e.g. `learn-ohrm` |
| `{{CREDENTIALS_NOTE}}` | "Credentials for host opensource-demo.orangehrmlive.com are stored in webnav and auto-filled on login." |

## Notes

- **Re-learning a site?** `webnav dev node-clear --node <id>` empties its map first (so you re-learn
  cleanly, never by hand-editing the DB). `node-rm` deletes it entirely.
- **Why "exercise each page" matters:** without it the recording only contains nav clicks, so the
  draft can only produce nav edges — a sidebar skeleton, not a usable map. Firing the filters/sorts/
  Add buttons is what populates each state's in-page affordance repertoire.
- **What you do NOT do:** crawl exhaustively, click destructive buttons, or hand-write the map. Drive
  the happy paths + exercise each page's controls; the draft does the rest.
- **Distribution:** once a common site is mapped, `webnav dev export-map <id>` emits a shareable map
  pack — most users IMPORT a pack rather than re-learn. Only the first mapper runs this prompt.
