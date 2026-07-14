# EnergyDashboard — Design Document

*The "why" behind the product. For the "how," see [`TECH-SPECS.md`](./TECH-SPECS.md)
and [`ARCHITECTURE.md`](./ARCHITECTURE.md).*

---

## 1. The thesis: observability, not arithmetic

Ontario's electricity market is unusually **transparent and unusually
hard to act on at the same time.** The IESO publishes real-time zonal
prices, nodal LMPs, demand, and the official ICI peak determinations — all
free, all public. The Ontario Energy Board publishes the regulated rate
plans. The settlement math (Global Adjustment, the 5CP Peak Demand Factor,
time-of-use billing) is written down in market manuals anyone can read.

None of that is the hard part. The hard part is **noticing** — turning a
firehose of XML reports and a page of settlement rules into a single,
timely answer to a question a real decision-maker is asking:

- *"Is today a peak I should curtail through?"*
- *"What does staying Class A actually save me this year?"*
- *"Did my bill just jump, and why?"*
- *"Am I on the wrong rate plan for how I actually use power?"*

EnergyDashboard's value-add is **observability**: the same public data and
the same public formulas, rendered as decisions instead of documents. The
math is deliberately not the moat — it's all in the market manuals. The
moat is that the numbers show up in the right place, at the right time,
already interpreted, for the person who has to act on them.

## 2. Two audiences, one contract

The product splits into two audience sections that share one technical
contract but almost nothing in mindset:

| | Industrial & Commercial (Class A) | Retail & Homeowner (Class B) |
| --- | --- | --- |
| **Who** | ICI participants, energy managers, FP&A, market operators | Households, renters, small-business / building managers |
| **Stakes** | Six figures a year in Global Adjustment | Tens of dollars a month, but opaque and stressful |
| **Question** | "When do I curtail, and is it worth it?" | "Is my bill normal, and am I on the right plan?" |
| **Data they bring** | Interval meter exports (MV-90, Itron) | A photo of a paper bill |
| **What they need** | Precision, provenance, dollar figures | Plain language, reassurance, privacy |

Keeping them in one app is a deliberate bet: the underlying market is one
system, and the same peak event that costs a factory its Peak Demand Factor
is the same event a homeowner's thermostat program is responding to.
Showing both sides in one place is itself a form of observability.

The **shared contract** (documented in `ARCHITECTURE.md`) means adding a
tab is cheap: a feature folder with pure business logic, one fetch hook, one
page-chrome component, one design-token palette. The audiences diverge in
*content and tone*, never in *architecture*.

## 3. Design principles

### 3.1 Privacy is a feature, not a footnote
The two most sensitive things a user can hand us — **interval meter data**
(a factory's operational fingerprint) and **a photo of an electricity
bill** (name, address, account number) — never leave the browser by
default.

- The **GA Exposure** simulator and the **Usage Review** anomaly engine run
  entirely as client-side pure functions. Uploaded CSVs and OCR'd bills
  live in React state and nothing else. No upload, no analytics beacon, no
  persistence.
- The *one* place a bill image can reach a server (the low-confidence OCR
  fallback) is an **ephemeral vision route**: it parses in memory, returns
  structured JSON, and terminates. It writes nothing and logs nothing
  derived from the image — a non-negotiable enforced in code and called out
  in the route's own comments.

This isn't just compliance hygiene; it's what makes the tools *usable* by
someone who would never paste their bill into a random website.

### 3.2 Honest by construction
The peak forecast could quietly report flattering accuracy numbers. It
doesn't. When the model's 14-day-ahead skill collapses to roughly the base
rate — because two weeks out there is no real weather forecast, only
climatology — the UI says so, in plain language, with the known-weather
ceiling shown right next to it ("14-day ≈ 0% by design"). Illustrative rate
figures are badged **illustrative** until a live regulator feed is wired.
Mock data wears a **Mock** pill; live data wears a green **Live** pill.

The product would rather show a smaller, true number than a larger,
convenient one. For an observability tool, credibility *is* the product.

### 3.3 Bring-your-own-data, meet-you-where-you-are
Class A users export interval data in whatever their meter vendor emits;
the GA tab parses MV-90/Itron/utility CSVs with configurable column
mapping and timestamp conventions. Homeowners have a paper bill and a phone
camera; the Usage Review tab starts from a photo. Both paths degrade
gracefully — partial meter coverage is flagged and annualized with a
caveat; a bill the OCR can't read confidently falls back to redact-then-
assist rather than failing.

### 3.4 Decisions, framed with their cost
Every recommendation carries its own downside. Curtailment ROI shows a
**negative expected value** as an honest "don't bother" signal when the
probability-weighted saving doesn't beat the curtailment cost. The rate
comparator shows the *annual* gap between plans, not just the winner, so a
$9/year difference reads as "don't bother switching." Observability
includes observing when the answer is *do nothing*.

## 4. The data-flow story

```
        PUBLIC SOURCES                 EDGE / CI                    BROWSER
   ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
   │ IESO public reports  │───▶│ /api/ieso (Vercel)   │───▶│ Overview · Nodal  │
   │ (zonal, nodal, demand)│    │ parse XML/CSV→JSON    │    │ live market view  │
   └──────────────────────┘    └──────────────────────┘    └───────────────────┘
   ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
   │ IESO demand + ECCC   │───▶│ peak pipeline (Node,  │───▶│ Peak Forecast     │
   │ weather + ICI peaks  │    │ nightly GitHub runner)│    │ (static JSON)     │
   └──────────────────────┘    └──────────────────────┘    └───────────────────┘
   ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
   │ Save on Energy / OEB │───▶│ weekly scraper (CI):  │───▶│ Conservation      │
   │ program + rate pages │    │ DOM-diff, flag drift  │    │ (static JSON)     │
   └──────────────────────┘    └──────────────────────┘    └───────────────────┘

   YOUR interval CSV  ─────────────────────────────────────▶ GA Exposure  (never leaves browser)
   YOUR bill photo    ─────────── on-device OCR ───────────▶ Usage Review (never leaves browser)
                                     └─ low-confidence only ─▶ ephemeral vision route (writes/logs nothing)
```

Three ingestion patterns, one rule: **public market data flows in through
cacheable edge/CI jobs; private user data flows nowhere.** The network
boundary is drawn exactly where the sensitivity is.

## 5. Why these six tabs

- **Overview** — the "what's happening right now" glance: map of zonal
  prices, 24h price curve, demand, and a GA peak-risk indicator. The entry
  point that makes the market legible in five seconds.
- **Nodal** — the depth view: 900+ pricing nodes decomposed into
  energy / congestion / loss / basis, pivoted by zone. For operators who
  need to see *where* on the grid the price is coming from.
- **Peak Forecast** — the flagship signal: which upcoming hours are likely
  to become one of the base period's five coincident peaks, with a
  measured-accuracy panel that refuses to oversell itself.
- **GA Exposure** — the money tab: your Peak Demand Factor, Class A vs
  Class B dollars with the break-even, per-peak savings, and curtailment
  ROI on the live forecast — all in-browser.
- **Conservation** — the retail catalog: rebate and demand-response
  programs organized by *what you're trying to do*, plus a
  TOU/ULO/Tiered rate comparator.
- **Usage Review** — the retail diagnostic: snap a bill, OCR it, and get
  anomalies (volume spike, on-peak shift, year-over-year jump) explained in
  a sentence.

Each tab answers exactly one question for exactly one mindset. That
discipline — one question per surface — is the whole design.

## 6. What we deliberately did *not* build

- **No accounts, no server-side user data store.** The moment we persist a
  user's bill or meter data, the privacy story collapses and the compliance
  surface explodes. We chose client-state over convenience.
- **No re-deriving official peaks from raw demand.** The ICI Peak Tracker
  publishes the ranking; we consume it. Fabricating "final" labels by
  sorting demand ourselves would be subtly wrong and dishonest.
- **No auto-rewriting curated program copy from the scraper.** Rebate
  criteria are nuanced; a bad automated edit is worse than a flagged stale
  one. The scraper *monitors and dates* changes; a human updates the words.
- **No standalone "model accuracy" tab (yet).** With one production model,
  a separate tab is premature UI. The scoring is model-agnostic underneath,
  so a second model is a data change, not a rebuild.

Each of these is a case where the disciplined, smaller product is the more
credible one — which, for a tool whose entire pitch is *trustworthy
observability*, is the right trade every time.
