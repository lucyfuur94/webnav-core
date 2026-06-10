'use client';

import { useState } from 'react';

export default function Keys() {
  const [email, setEmail] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(email ? { email } : {}),
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const data = await res.json();
      setKey(data.key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="py-16">
      <h1 className="text-3xl font-bold">Get a free API key</h1>
      <p className="mt-3 max-w-xl text-muted">
        For the hosted route. Free tier, no card. Email is optional (recovery only). Your site logins are
        never involved — credentials always stay on your machine.
      </p>

      {!key ? (
        <div className="mt-8 max-w-md rounded-xl border border-border bg-panel p-6">
          <label className="block text-sm text-muted">Email (optional)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={issue}
            disabled={loading}
            className="mt-4 w-full rounded-md bg-accent px-4 py-2 font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Issuing…' : 'Issue free key'}
          </button>
          {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        </div>
      ) : (
        <div className="mt-8 max-w-2xl rounded-xl border border-accent bg-panel p-6">
          <p className="text-sm text-muted">Your key (shown once — save it now):</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm">{key}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(key); setCopied(true); }}
              className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-4 text-sm text-muted">Then, in your terminal:</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-bg p-3 font-mono text-sm">{`webnav login ${key}\nwebnav walk --hosted --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-complete`}</pre>
        </div>
      )}
    </div>
  );
}
