// Single source of truth for tiers + quotas — used BOTH by the pricing page (to
// render the table) and by the API (to enforce monthly quotas). Edit numbers here
// only. `mapFetchesPerMonth` is the metered unit (one hosted `walk --hosted`
// fetches one site map = one unit). null = unlimited.

export interface Tier {
  id: 'self-host' | 'free' | 'starter' | 'pro';
  name: string;
  price: string;          // display string
  priceNote?: string;
  mapFetchesPerMonth: number | null;  // quota for the metered hosted route
  features: string[];
  cta: string;
  highlight?: boolean;
}

export const TIERS: Tier[] = [
  {
    id: 'self-host',
    name: 'Self-host',
    price: 'Free forever',
    priceNote: 'Apache-2.0, open source',
    mapFetchesPerMonth: null,
    features: [
      'Run the `webnav` CLI on your machine',
      'Build & own your maps locally',
      'Self-healing on use',
      'Credentials never leave your machine',
      'No account, no key, no limits',
    ],
    cta: 'Get it on GitHub',
  },
  {
    id: 'free',
    name: 'Hosted — Free',
    price: '$0',
    priceNote: 'per month',
    mapFetchesPerMonth: 1000,
    features: [
      'Use the maintained shared map',
      '1,000 map fetches / month',
      'Always the latest maps',
      'Credentials still stay local',
      'API key, no card required',
    ],
    cta: 'Get a free key',
    highlight: true,
  },
  {
    id: 'starter',
    name: 'Hosted — Starter',
    price: '$9',
    priceNote: 'per month',
    mapFetchesPerMonth: 25000,
    features: [
      'Everything in Free',
      '25,000 map fetches / month',
      'Priority map freshness',
      'Email support',
    ],
    cta: 'Coming soon',
  },
  {
    id: 'pro',
    name: 'Hosted — Pro',
    price: 'Usage-based',
    priceNote: 'metered per fetch',
    mapFetchesPerMonth: null,
    features: [
      'Everything in Starter',
      'Unlimited fetches, billed per use',
      'Volume pricing',
      'SLA + private maps (roadmap)',
    ],
    cta: 'Contact us',
  },
];

/** Monthly quota for a tier id (null = unlimited). Used by the API to enforce. */
export function quotaFor(tier: string): number | null {
  const t = TIERS.find((x) => x.id === tier);
  if (!t) return TIERS.find((x) => x.id === 'free')!.mapFetchesPerMonth;
  return t.mapFetchesPerMonth;
}
