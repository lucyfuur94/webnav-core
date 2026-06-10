const GITHUB = 'https://github.com/lucyfuur94/webnav';

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-panel p-4 font-mono text-sm leading-relaxed">
      {children}
    </pre>
  );
}
function H2({ children, id }: { children: React.ReactNode; id: string }) {
  return <h2 id={id} className="mt-10 text-2xl font-semibold">{children}</h2>;
}

export default function Docs() {
  return (
    <article className="py-12">
      <h1 className="text-3xl font-bold">Docs</h1>
      <p className="mt-3 max-w-2xl text-muted">
        webnav is a CLI an AI agent shells out to. It navigates sites deterministically and hands back
        compact evidence; the agent does all the judgment. Full reference lives in the{' '}
        <a className="underline hover:text-fg" href={`${GITHUB}#readme`}>README</a>.
      </p>

      <H2 id="install">Install</H2>
      <Code>{`git clone ${GITHUB}
cd webnav
npm install        # Node 18+
npm link           # puts \`webnav\` on PATH (runs source via tsx — no build)
webnav --help      # the tool menu`}</Code>
      <p className="mt-2 text-sm text-muted">Needs <code className="font-mono">playwright-cli</code> on PATH.</p>

      <H2 id="map">How the map grows</H2>
      <p className="mt-3 max-w-2xl text-muted">
        A fresh install seeds one worked example — <strong className="text-fg">saucedemo.com</strong> — into a
        shared, per-user map at <code className="font-mono text-fg">~/.webnav/webnav.db</code>. It persists and
        self-heals on use: when a remembered step drifts, the walk asks once, then writes the fix back so the
        next run is deterministic again. Mapping a brand-new site is a recording flow (roadmap: one-command
        mapping + shareable map packs).
      </p>

      <H2 id="self-host">Self-host route (free)</H2>
      <Code>{`webnav walk --start www.saucedemo.com:login \\
            --goal  www.saucedemo.com:checkout-complete
# pauses at forks for the agent; resume with:
webnav walk-resume <session> --ref <e42>
webnav walk-resume <session> --classify safe   # at a commit point`}</Code>

      <H2 id="hosted">Hosted route (shared knowledge)</H2>
      <p className="mt-3 max-w-2xl text-muted">
        Use the maintained central map instead of building your own. Get a free key, save it, then add{' '}
        <code className="font-mono text-fg">--hosted</code>. The map is fetched live; your credentials still
        load locally.
      </p>
      <Code>{`webnav login wn_live_xxx          # free key from the Get-a-key page
webnav walk --hosted \\
  --start www.saucedemo.com:login \\
  --goal  www.saucedemo.com:checkout-complete`}</Code>

      <H2 id="creds">Credentials</H2>
      <p className="mt-3 max-w-2xl text-muted">
        Store site logins locally — never in the map, never sent to the hosted service:
      </p>
      <Code>{`webnav creds set www.saucedemo.com username=standard_user password=secret_sauce
# stored at ~/.webnav/credentials.json (chmod 600); the walk auto-fills them`}</Code>

      <H2 id="verbs">Core verbs</H2>
      <ul className="mt-3 space-y-1 text-sm text-muted">
        <li><code className="font-mono text-fg">recall</code> — replay a goal’s route → evidence bundle (the agent ranks)</li>
        <li><code className="font-mono text-fg">search</code> — multi-provider open-web search → extracted evidence</li>
        <li><code className="font-mono text-fg">walk</code> / <code className="font-mono text-fg">walk-resume</code> — deterministic multi-step travel with pause/resume</li>
        <li><code className="font-mono text-fg">locate</code> / <code className="font-mono text-fg">route</code> / <code className="font-mono text-fg">hop</code> — place lookup + the internet graph</li>
        <li><code className="font-mono text-fg">dev outline</code> / <code className="font-mono text-fg">dev dashboard</code> — inspect what’s mapped</li>
      </ul>
      <p className="mt-3 text-sm text-muted">Run <code className="font-mono text-fg">webnav --help</code> for the full menu.</p>
    </article>
  );
}
