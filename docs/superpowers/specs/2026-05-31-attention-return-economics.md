# Attention-Return Economics — Thesis & Design Note

**Date:** 2026-05-31
**Status:** Thesis (not yet built). Layers onto the future "sanctioned-doors" layer
(see the internet-graph spec). Captured so the economic model is settled before code.

> **The question that started this:** in the agent-web, why must an agent pay to
> visit a site a human visits free? And — what if the agent could bring the
> *attention* back, so the site no longer needs to charge?

## 1. Why the free web charges agents (the problem)

The "free" web was never free — it was a **barter: content for human attention.**
The human pays in eyeballs (ads), brand affinity, data, and purchase potential. The
page is bait; the human's attention is the catch.

An **agent breaks the barter**: it extracts the content (the expensive part) but pays
no attention (the part that funded the content) — no ad impressions that matter, no
brand loyalty, no retargeting — and can do so at machine scale on the site's servers.
So sites respond by **walling agents** (crude) or **charging them** (APIs, per-call
fees, agent tolls — the emerging model). The toll is the site re-pricing a visitor who
consumes value but carries no attention-currency.

## 2. The thesis: make agents attention-ALIVE, honestly

If the agent **returns qualified attention** to the user on the site's behalf — reads
the page's offers, remembers them, and (transparently, with consent) surfaces the
right one at a genuine intent moment later — the barter is restored. And it can be
*better than the human web*: a human ignores 99% of ads (wasted impressions); an agent
that knows the user's context can surface the *one relevant offer at the moment of real
intent* — **intent-qualified attention, which advertisers value far more than raw
impressions.**

If agents demonstrably return monetizable attention, the site's incentive flips from
"wall/toll the agent" to "welcome the agent that pays me in attention." **The toll
isn't inevitable; it's a response to agents being attention-dead.**

## 3. The trust problem, and the solve (verify the conversion, not the impression)

The site can't *see* the agent fulfilling the attention (it happens privately between
agent and user). So how does it trust it happened?

**Solve — Option A (the realistic one): verify the OUTCOME, not the impression.** The
agent doesn't prove it "showed the ad." When it surfaces a remembered offer and the
user acts, it routes that action through an **attributable link / referral token the
site issued.** The site sees a conversion arrive tagged "via agent X" — the exact
attribution it *already* trusts for affiliates. No new trust primitive required; it
piggybacks on existing affiliate/referral rails, and conversions (unlike impressions)
aren't gameable.

This reframes the model precisely: not a vague "attention barter" but **a performance/
affiliate model where the agent is an unusually high-quality referrer** — it surfaces
the offer only at genuine intent, so its referrals convert far better than a banner.
(Crypto-signed delivery receipts (Option B) and privacy-preserving aggregate signals
(Option C) exist for brand/awareness goals with no click, but A is the one that works
today.)

## 4. The only real constraint: honest communication (not anti-"adware" machinery)

An earlier draft over-engineered this with a "decouple pay from recommendation to avoid
adware" structure. That was wrong, and worth correcting plainly:

- **An agent showing a labeled, relevant, consented offer is just ADVERTISING** — the
  same legitimate thing as a search ad, a sponsored result, a billboard. There is
  nothing wrong with it; it's precisely what could let sites drop the toll (§2).
- The LLM has **no "selfish incentive."** It follows its instructions. So the risk was
  never a greedy model — any risk lives with the **operator** who writes the agent's
  instructions/funding.
- **The one real line is the ordinary advertising ethic: don't deceive.** Label ads as
  ads, disclose sponsorship, never pass paid placement off as neutral recommendation.
  That's the difference between honest advertising (fine) and deceptive/biased advice (not).
  It is NOT a novel agent-web hazard requiring special plumbing — it's standard disclosure.

So the requirement collapses to one rule:

> **Communicate honestly.** When the agent surfaces an offer, it is clearly labeled as a
> sponsored/paid offer and distinguishable from the agent's neutral recommendations. No
> disguising paid placement as impartial advice. Beneficiary can see and switch it off.

That's it. No pooling, no decoupling-the-paycheck machinery — those solved an invented
problem. Operators who deceive lose user trust (and run into ordinary advertising/
disclosure regulation); that market + legal discipline is the same one all advertising
already lives under.

**Payment terms can be impression-based OR conversion-based** — both are legitimate and
the doors layer should let a site declare either:
- *Conversion/click* (referral token): self-verifying (the tagged action reaches the
  site), but pays for getting the user to act.
- *Impression* (the agent surfaced the labeled offer): gentler — pays for the honest
  mention, no push-to-convert — but harder to verify (needs a trusted attestation/
  receipt, since the showing happens privately). Choose per site/relationship.

## 5. Who is the PRINCIPAL? (generalized — both deployment shapes)

The agent calling webnav may be the **end-user's own agent** (user pays, user is
principal) OR a **company's agent acting on behalf of its users** (company pays,
company is principal, users are beneficiaries) — e.g. a travel site's assistant, a
bank's concierge, a SaaS embedding webnav.

The alignment rule is **principal-agnostic**:

> The agent must be funded by, and accountable to, a principal who has a **genuine
> stake in the beneficiary being well-served**. The end-user's interest is protected
> by transparency + the operator's retention incentive (+ eventually regulation).

- **User's own agent:** principal = user; alignment via user payment + user can drop it.
- **Company-on-behalf-of-users:** principal = company; alignment via the company's
  user-retention / competitive pressure (a concierge that pushes bad options for
  commission loses customers to a rival). Market discipline moves up a level.
- **Failure mode (the line):** a payer whose interest is *opposed* to the beneficiary's
  (e.g. an operator that instructs the agent to disguise paid placements as neutral
  advice) → deceptive/biased advice. The guard is honest disclosure (§4) + the
  retention/regulation discipline, not special machinery.

Company-scale deployment actually **strengthens** the model: attention/conversions
aggregate into real volume that sites will negotiate B2B terms for — a business
agreement rather than per-individual micro-settlement.

## 6. webnav's role: the honest, principal-AGNOSTIC substrate

webnav does NOT become an ad-broker, payment rail, or the thing that decides to show
you an offer. It stays the judgment-free map (#5a). Its only NEW responsibilities,
layered onto the doors model:

1. **Record offers as evidence** — "on this site I saw these offers," labeled, in the
   evidence bundle (offers are just more declared content to extract).
2. **Carry per-node access/attention TERMS** in the doors/graph layer:
   `open | api-key | cash | attention-loop` — *this node welcomes agents that
   participate in attribution.* Routing prefers the cheapest sanctioned door.
3. **Emit attribution tokens on CONSENTED actions** — when the calling agent (with the
   beneficiary's consent) acts on an offer, navigate via the site's referral token
   (Option-A verification — just "navigate to a tagged URL," which webnav already does).

What webnav must NEVER do: decide to surface an offer (the calling agent + its
principal's settings do that), manufacture access the principal doesn't have, or evade
a wall/toll. The fiduciary/transparency logic lives in the calling agent and its
operator — exactly where #5a puts all judgment.

## 7. Would you still need to pay? (the honest answer)

Not necessarily — the toll can become a **currency, not a fee**:
- **Attention-for-access:** agents that return verified, qualified attention → site
  drops the toll. The original web deal, restored and arguably improved.
- **Hybrid:** participating agents pay less/nothing; pure extractors pay the toll. The
  toll becomes the *default for non-participating agents*, waived for participating ones.
- **Cash anyway** for sites whose model isn't ad-based (paywalled journalism, SaaS) —
  there, money is cleaner than attention.

So: for ad-supported sites, the toll's justification largely dissolves once agents are
made honestly attention-alive. For others, the doors layer still routes to the cheapest
sanctioned door (which may be a paid API).

## 8. Hard problems still open (not hand-waved)

- **Attribution plumbing** (who pays whom, revenue share, settlement) — needs a layer;
  affiliate/referral rails are the bootstrap for conversion-based terms.
- **Impression verification** — if a site is paid per labeled-impression, it can't see
  the private showing; needs a trusted attestation/receipt. (Conversion-based terms
  sidestep this — the tagged action self-verifies.)
- **Standardizing "attention-terms"** so sites can declare them (an `llms.txt`-like
  field) — doesn't exist yet.
- **Disclosure enforcement** — ensuring operators actually label sponsored offers and
  don't disguise them as neutral advice. This is ordinary advertising-disclosure
  ground (market trust + regulation), not a webnav-specific mechanism.
- **Regulatory** treatment of agent-mediated advertising / disclosure — nascent.

## 9. Relationship to the build

This depends on the **sanctioned-doors layer** (per-node access terms on the graph),
which is the agreed next architectural increment. The attention-return model extends
that layer's terms vocabulary (`+ attention-loop`) and adds webnav's three honest
responsibilities (§6). It is NOT a near-term coding task — it's the economic north-star
that the doors layer should be designed to *not preclude*. Build doors first; keep the
attention-terms field in the schema from the start so this can land later without rework.

## 10. PARKED — not testable enough to build yet (decision 2026-06-01)

Real-world recon confirmed the ecosystem is forming exactly as theorized — but it is
too early/gated for us to test end-to-end, so we are NOT building the attention/
attribution thread now:
- **Pay-per-crawl / 402 is PRIVATE BETA** (Cloudflare). Named participating publishers
  exist (Time, Condé Nast, AP, Reddit, Stack Overflow, Quora, Pinterest…), but probing
  them today returns **block/302/`cf-mitigated: challenge`, not a 402 toll** — the toll
  isn't observable without crawler-beta access. (Our R2 already detects the
  challenge/interstitial, which is the honest behavior.)
- **Real attribution PAYOUT needs an affiliate account + a real sale** (Amazon
  Associates / eBay Partner Network / a Shopify store) — not ours to fake.
- **Industry is real & live** (for the record): Cloudflare pay-per-crawl (402),
  OpenAI Ads Manager (labeled "sponsored" in ChatGPT, May 2026), Walmart Sparky / Amazon
  Rufus / Google AI Mode ads, Shopify agentic storefronts (5.6M stores), server-side/
  affiliate attribution as the agreed tracking answer. Our thesis matched it.
- **What WOULD be testable now (deferred with the rest):** (a) detect+report a toll/
  challenge header as a "door requires payment/challenge" signal (extends R2), and
  (b) preserve an attribution tag through a consented navigation (assert the visited URL
  keeps `?aff=…`). Pure mechanics, no accounts — pick these up first if/when we revisit.

**Revisit trigger:** we obtain Cloudflare pay-per-crawl beta access OR a real affiliate
account, OR a participating publisher starts returning live 402s to ordinary crawlers.
Until then: do not build; the corrected thesis above is the record.
