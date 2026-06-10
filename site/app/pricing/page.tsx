import Link from 'next/link';
import { TIERS } from '@/lib/pricing';

const GITHUB = 'https://github.com/lucyfuur94/webnav';

export default function Pricing() {
  return (
    <div className="py-12">
      <h1 className="text-3xl font-bold">Pricing</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Open-core. The CLI is <strong className="text-fg">free forever</strong> (Apache-2.0) — self-host and
        you pay nothing, ever. The hosted “shared knowledge” route is metered by usage: one{' '}
        <code className="font-mono text-fg">walk --hosted</code> fetches one site map = one unit.
      </p>

      <div className="mt-10 grid gap-5 lg:grid-cols-4 sm:grid-cols-2">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className={`flex flex-col rounded-xl border bg-panel p-6 ${
              t.highlight ? 'border-accent' : 'border-border'
            }`}
          >
            <h3 className="font-semibold">{t.name}</h3>
            <div className="mt-2">
              <span className="text-2xl font-bold">{t.price}</span>
              {t.priceNote && <span className="ml-1 text-sm text-muted">{t.priceNote}</span>}
            </div>
            <p className="mt-3 text-sm text-muted">
              {t.mapFetchesPerMonth === null ? 'Unlimited map fetches' : `${t.mapFetchesPerMonth.toLocaleString()} map fetches / mo`}
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-muted">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2"><span className="text-accent">✓</span>{f}</li>
              ))}
            </ul>
            <div className="mt-6">
              {t.id === 'self-host' ? (
                <a href={GITHUB} className="block rounded-md border border-border px-4 py-2 text-center text-sm hover:border-accent">{t.cta} ↗</a>
              ) : t.id === 'free' ? (
                <Link href="/keys" className="block rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-bg hover:opacity-90">{t.cta}</Link>
              ) : (
                <span className="block rounded-md border border-border px-4 py-2 text-center text-sm text-muted">{t.cta}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted">
        Paid tiers and exact metering are rolling out — Free works today. The gate is server-side: a key is
        required to read shared maps, and usage is metered per key. No key? The self-host route stays free and
        unlimited.
      </p>
    </div>
  );
}
