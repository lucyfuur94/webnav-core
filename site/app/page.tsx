import Link from 'next/link';

const GITHUB = 'https://github.com/lucyfuur94/webnav';

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-panel p-4 font-mono text-sm leading-relaxed">
      {children}
    </pre>
  );
}

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="py-20 text-center">
        <p className="mb-3 font-mono text-sm text-accent">A navigation memory for AI agents</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Your agent <span className="text-accent">recalls</span> the route — instead of re-exploring.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          webnav remembers how to get around websites. It’s a deterministic,{' '}
          <strong className="text-fg">zero-LLM</strong> navigation memory: agents walk known routes
          page-to-page — cheap, reliable, self-healing — and spend their expensive reasoning on judging
          results, not re-finding them.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/docs" className="rounded-md bg-accent px-5 py-2.5 font-medium text-bg hover:opacity-90">Get started</Link>
          <a href={GITHUB} className="rounded-md border border-border px-5 py-2.5 font-medium hover:border-accent">Star on GitHub ↗</a>
        </div>
      </section>

      {/* Two routes */}
      <section className="grid gap-5 py-8 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-6">
          <h3 className="text-lg font-semibold">Self-host — free forever</h3>
          <p className="mt-2 text-sm text-muted">
            Run the open-source CLI. Build and own your maps locally; they persist and self-heal on use.
            No account, no key, no limits. Credentials never leave your machine.
          </p>
          <div className="mt-4">
            <Code>{`npm install -g  # or npm link from the repo
webnav walk --start www.saucedemo.com:login \\
            --goal  www.saucedemo.com:checkout-complete`}</Code>
          </div>
        </div>
        <div className="rounded-xl border border-accent/40 bg-panel p-6">
          <h3 className="text-lg font-semibold">Hosted — shared knowledge</h3>
          <p className="mt-2 text-sm text-muted">
            Skip building maps. Use the maintained, central map over the network — always the latest.
            A free key gets you going; usage-based tiers as you grow.{' '}
            <strong className="text-fg">Your credentials still stay 100% local.</strong>
          </p>
          <div className="mt-4">
            <Code>{`webnav login wn_live_xxx       # free key from /keys
webnav walk --hosted \\
  --start www.saucedemo.com:login \\
  --goal  www.saucedemo.com:checkout-complete`}</Code>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {[
            ['Nodes = states', 'What’s true on a page and what you can do from it. A URL is an attribute of a state, not the state itself.'],
            ['Edges = actions', 'Click / type / navigate transitions, each carrying cost, reliability, and confidence that decays with age and rises with use.'],
            ['Recall, don’t re-explore', 'The second time an agent needs to get somewhere, it replays the route deterministically — zero LLM on the journey.'],
          ].map(([h, b]) => (
            <div key={h} className="rounded-xl border border-border bg-panel p-5">
              <h3 className="font-semibold">{h}</h3>
              <p className="mt-2 text-sm text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Credentials promise */}
      <section className="my-8 rounded-xl border border-border bg-panel p-6">
        <h2 className="text-xl font-semibold">Your logins never leave your laptop</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Whether you self-host or use the hosted route, webnav only ever moves the <em>map</em> — the
          navigation skeleton of a site. Site credentials are stored locally at{' '}
          <code className="font-mono text-fg">~/.webnav/credentials.json</code> (chmod 600) and are filled
          by the browser on your machine at walk time. The hosted service has no credential storage by design.
        </p>
      </section>
    </div>
  );
}
