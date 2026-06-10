import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'webnav — a navigation memory for AI agents',
  description:
    'webnav remembers how to get around websites so your AI agent recalls cheap, reliable routes — deterministic, zero-LLM, self-healing — instead of re-exploring every time.',
  metadataBase: new URL('https://webnav.dpdns.org'),
  openGraph: {
    title: 'webnav — a navigation memory for AI agents',
    description: 'A deterministic, zero-LLM navigation memory for AI agents.',
    type: 'website',
  },
};

const GITHUB = 'https://github.com/lucyfuur94/webnav';

function Nav() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <Link href="/" className="font-mono text-base font-semibold">
          web<span className="text-accent">nav</span>
        </Link>
        <div className="flex items-center gap-5 text-sm text-muted">
          <Link href="/docs" className="hover:text-fg">Docs</Link>
          <Link href="/pricing" className="hover:text-fg">Pricing</Link>
          <Link href="/keys" className="hover:text-fg">Get a key</Link>
          <a href={GITHUB} className="rounded-md border border-border px-3 py-1.5 hover:border-accent hover:text-fg">GitHub ↗</a>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-5 py-8 text-sm text-muted">
        <p>
          webnav · open source under <a className="underline hover:text-fg" href={`${GITHUB}/blob/main/LICENSE`}>Apache-2.0</a> ·{' '}
          <a className="underline hover:text-fg" href={GITHUB}>GitHub</a>
        </p>
        <p className="mt-2">The hosted route serves map skeletons only — your credentials never leave your machine.</p>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto max-w-5xl px-5">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
