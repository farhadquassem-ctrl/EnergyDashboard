# Prompt — GA Exposure Simulator (Class A / ICI), for Fable

**Run this on a fresh `claude/ga-exposure-simulator` branch off `main`.** This is
Prompt 3 from `energy_dashboard_build_prompts_1.md`, expanded with the meter-
ingestion, Peak-Demand-Factor, and per-coincident-peak savings requirements
below. Build it to the shared architecture contract — read
**`docs/ARCHITECTURE.md` first** — and do not duplicate data-fetching, charting,
or the peak-forecast logic that already exists.

---

## Context you're inheriting (already built — reuse, don't rebuild)

- **Architecture contract** (`docs/ARCHITECTURE.md`): types in
  `src/types/market.js` (JSDoc); IESO adapters in `src/lib/ieso/`; one fetch
  hook `src/lib/query/useMarketQuery.js` keyed `[market, zone, dateRange]`;
  global state `src/store/marketStore.jsx` (has a shared `customerProfile`,
  default `{ mw: 1 }` — **extend this object, don't fork it**); page chrome
  `src/components/TabShell.jsx`; shared `PriceChart`; new tabs live at
  `src/features/<tab-name>/` = `index.jsx` + `hooks.js` + pure
  `calculations.js` + `components/`. `features/peak-forecast/` is the reference.
- **Peak forecast** (`public/peak-forecast/forecast.json`, adapter
  `src/lib/ieso/peakForecast.js`): carries the current base period's
  `running5CP` board + `threshold`, and `predictedPeaks[]` each now with a
  **calibrated numeric `probability`** (P(top-5)), `predictedMw`, `daysOut`,
  `wouldRankTop5`. Normalize via `forecastToGAForecasts` → shared `GAForecast`.
- **Prediction log** (`public/peak-forecast/prediction_log.json`, adapter
  `src/lib/ieso/predictionLog.js`): `ModelPrediction[]`, resolved as reality
  arrives — the source of *actual* peak MW per past day.
- **Base/billing periods**: ICI base period = **May 1 – Apr 30**, labelled by
  its start year; a base period's 5CP set the customer's factor for the
  **following** billing period **Jul 1 – Jun 30** (base 2026 → billed Jul 2027 –
  Jun 2028). Pipeline helpers `basePeriodBounds` / `billingPeriodBounds` exist
  (pipeline side); mirror the same convention app-side.
- **Test runner**: `npm test` (`node --test "src/**/*.test.js"`). Put pure
  logic in `calculations.js` and cover it.

Tab: add `{ id: 'ga-exposure', label: 'GA Exposure' }` to `TABS` in
`src/App.jsx`, lazy-loaded like the other heavy tabs.

---

## OBJECTIVE

Let an Ontario electricity consumer upload their facility's interval meter data
and see, in dollars:

1. Their **Global Adjustment (GA) cost under Class A (ICI) vs. Class B**, with
   the break-even Peak Demand Factor highlighted.
2. Their **Peak Demand Factor (PDF)** for a chosen base period, and the GA $
   that flows from it over the billing period.
3. **Annual $ saved (or potential savings), decomposed by each of the 5
   Coincident Peaks** — CP1 → $x₁, CP2 → $x₂, … summing to the total — so the
   user sees that hitting each peak adds up, and that partial curtailment (not
   all 5) still saves real money.
4. A forward-looking **“should I curtail today/this week”** signal driven by the
   peak forecast's numeric probability.

This is the highest-commercial-value tab. **Clarity and correctness of the
dollar figures beat visual polish** — a wrong or confusing number here
undermines trust in the whole product.

---

## 1. METER DATA INGESTION (first-class, do this properly)

Real customers arrive with exports from MDM/meter systems (MV-90 / MV-WEB,
Itron, generic utility CSV, sometimes GreenButton XML). Build a robust,
**format-agnostic CSV ingester** with a mapping step; MV-90-style exports are
the priority preset.

- **Upload + parse**: CSV first (support delimiter sniffing and a header row;
  tolerate metadata preamble lines above the header, which MV-90 exports often
  have). Accept `.csv`/`.txt`. Structure the parser so a GreenButton/ESPI XML
  reader can be added later without reworking the pipeline.
- **Column mapping UI with auto-detection, user-overridable.** Sniff header
  names and let the user correct every choice:
  - **Timestamp** column(s) — support a single ISO/`MM/DD/YYYY HH:MM` column
    *or* split date + interval-ending time (MV-90 commonly emits interval-
    **ending** timestamps — make ending-vs-starting a toggle, it shifts every
    reading by one interval).
  - **Quantity** column — the reading. Detect and let the user pick which
    physical quantity and unit it is:
    - Energy per interval: **kWh** or **MWh** (most common).
    - Demand: **kW** or **MW** (convert to energy using the interval length).
    - **Consumed vs generated / delivered vs received**: many meters emit
      separate channels (e.g. kWh delivered = consumption, kWh received =
      on-site generation export). Let the user map both; **net load =
      delivered − received**. For ICI, the billing-relevant quantity is
      **withdrawal from the grid (net consumption)** — make that explicit.
  - **Derive real power from kVA/kVAR when kW isn't present.** If the export
    only has apparent (**kVA**/**kVAh**) and reactive (**kVAR**/**kVARh**),
    derive real power `kW = sqrt(max(0, kVA² − kVAR²))` (equivalently via power
    factor if a PF column exists). Offer this as an explicit “derive real power”
    option and show the assumption; never silently guess.
- **Interval detection + normalization**: infer the interval (5 / 15 / 30 / 60
  min) from timestamp spacing; show it and let the user override. **Aggregate
  to hourly** (the granularity of Ontario demand and the 5CP), summing energy
  within each clock hour → an hourly average-MW series. Align to **Eastern
  Prevailing Time (EPT, America/Toronto, DST-aware)** to match IESO demand and
  the 5CP hours — this alignment is the single most error-prone step; get it
  right and unit-test it (including a DST spring-forward/fall-back day).
- **Validation, surfaced clearly, never silent**: malformed/short rows,
  duplicate timestamps, gaps (missing intervals), non-monotonic time, implausible
  units (e.g. values that imply MW when the user said kW), and coverage vs the
  selected base period (“your file covers 320 of 365 days; 12 of the base
  period's candidate-peak days are missing”). Missing data during an actual CP
  hour materially changes the PDF — flag it loudly.
- Keep the uploaded data **client-side** (privacy: it's a customer's load
  profile). No upload to any server.

---

## 2. DOMAIN METHODOLOGY — build to the published IESO ICI spec, cite it, flag ambiguity

Implement to the **standard IESO Industrial Conservation Initiative (ICI)**
methodology and **cite the specific rule in a code comment above each function**
so the math is auditable. Where the public spec is ambiguous or a convention
could go more than one way (base-period window edges, class-transition timing,
rounding, exactly which quantity is the PDF denominator), **STOP and ask rather
than guessing** — surface the specific decision point.

**Peak Demand Factor (PDF).** A base period's **5 Coincident Peaks** are the 5
highest Ontario-demand hours (the IESO/“AQEW”-ranked provincial peaks — reuse
the peak labels the pipeline already determines; **never re-rank raw demand
yourself** — see CLAUDE.md). The customer's PDF is their share of those peaks:

```
PDF = Σ_{i=1..5} customerMW_i / Σ_{i=1..5} ontarioMW_i
```

where `customerMW_i` is the customer's metered net withdrawal during CP hour i
and `ontarioMW_i` is the Ontario demand at that same hour. **Flag explicitly**
if any of the 12-month base-period window rules, the class-transition timing, or
the rounding convention is unclear from public docs — do not silently assume.

> Note the alternative some explainers use — `PDF = (1/5) Σ (customerMW_i /
> ontarioMW_i)` (average of per-peak ratios). It differs from the Σ/Σ form when
> the Ontario peaks differ in magnitude. **Implement the Σ/Σ form above as the
> default** (it's the standard and it makes the per-CP decomposition in §3
> exactly additive), but keep the ratio definition swappable and flag the choice.

**GA dollars.** A Class A consumer's GA charge for a month = `PDF × (that
month's total Class A GA $)`. Over the billing period, annual Class A GA =
`PDF × Σ(monthly Class A GA totals, Jul–Jun)`. **You need the monthly GA
amounts** — add a `src/lib/ieso/globalAdjustment.js` adapter for IESO's
published monthly GA (Class A total $, and the Class B volumetric rate $/kWh).
If a live fetch isn't feasible from the serverless proxy, follow the pipeline
pattern: commit a small static `public/ga/monthly_ga.json` (with a clear
`source`/`asOf`) and read it — but make the numbers real and cite the source,
and let the user override the rate assumptions in the UI.

**Class A vs Class B.** Class B pays GA as a volumetric rate on all consumption
(`ClassB_GA = ΣannualConsumptionkWh × rate$perkWh`). Class A pays `PDF ×
Σ monthly Class A GA`. Compute both for the uploaded profile and show the
**break-even PDF** (the PDF at which Class A cost = Class B cost) — below it
Class A wins, above it Class B wins.

---

## 3. CORE CALCULATIONS (`calculations.js`, pure, unit-tested)

- `normalizeMeterToHourly(rows, mapping)` → hourly `{ timestampEPT, netMwh,
  netMw }[]`, applying unit/interval/derive-from-kVA/net-of-generation/timezone
  rules from §1. Pure; the ingestion UI feeds it a parsed table + a mapping.
- `computePDF(hourlyLoad, coincidentPeaks)` → `{ pdf, perPeak: [{ cpRank, date,
  hour, customerMw, ontarioMw, share }] }`. `coincidentPeaks` is the base
  period's 5CP (customerMw looked up from the uploaded profile at each CP hour;
  ontarioMw from the peak labels). Cite the ICI rule.
- `computeGAExposure(pdf, monthlyClassAGA)` → annual Class A GA $ over the
  billing period (and monthly breakdown).
- `compareClassAvsClassB(pdf, annualConsumptionKwh, monthlyClassAGA,
  classBRatePerKwh)` → `{ classA$, classB$, breakevenPdf, recommendedClass }`.
- **`savingsByCoincidentPeak(perPeak, monthlyClassAGA, curtailmentPlan)`** →
  the headline feature. For each CP i, the marginal GA $ attributable to the
  customer's load at that peak is `(customerMw_i / Σ ontarioMw) × annualClassAGA`.
  Curtailing CP i from `customerMw_i` to `curtailedMw_i` saves
  `((customerMw_i − curtailedMw_i) / Σ ontarioMw) × annualClassAGA`. Return the
  per-CP saving `[{ cpRank, date, baselineContribution$, saving$, residual$ }]`
  and the total — so the UI can show CP1 → $x₁ … CP5 → $x₅ and the running sum,
  demonstrating that even curtailing a subset banks real savings. (This
  additivity is exactly why §2 uses the Σ/Σ PDF form.)
- `simulateCurtailmentROI(predictedPeaks, curtailableMw, curtailmentCostPerEvent,
  monthlyClassAGA)` → **forward-looking, probability-weighted** expected savings:
  for each upcoming predicted peak, `EV = probability × perPeakSaving −
  curtailmentCostPerEvent`. Use the forecast's numeric `probability` (not a
  binary flag) so the user sees confidence-weighted expected value, and rank
  the upcoming days by EV.
- `dailyCurtailmentSignal(forecast, threshold)` → today's/this week's
  curtail-or-monitor recommendation **with the underlying probability shown**,
  not just a flag.

Support **two modes**, sharing the calculations:
- **Actual / historical** — user uploads a *completed* base period; use its
  final 5CP (from the pipeline peak labels / prediction log) to show realized
  PDF, realized Class A vs B, and what each CP *did* cost / could have saved.
- **Forward / what-if** — current in-progress base period; use `running5CP` +
  `predictedPeaks` to show PDF-to-date, projected end-of-period exposure, and
  probability-weighted savings from curtailing the upcoming predicted peaks.

---

## 4. UI (compose inside `<TabShell>`)

- **Upload + mapping panel** with live validation feedback and the auto-detected
  mapping pre-filled (editable). Show the detected interval, timezone handling,
  and coverage-vs-base-period summary.
- **PDF card** — the computed PDF with the 5 CP hours it's built from (date,
  hour, your MW, Ontario MW, your share), and which base/billing period applies.
- **Class A vs B comparison card** with the break-even PDF chart (cost vs PDF,
  the two lines crossing at break-even, the customer's PDF marked).
- **Savings-by-coincident-peak** — the centerpiece: a per-CP breakdown (bar or
  waterfall) CP1…CP5 with $ each and a cumulative total, plus a control to set
  the curtailment target MW per CP (or a global “curtail to X MW”) and watch the
  total update. Make “curtail 3 of 5” vs “all 5” trivially comparable.
- **Curtailment ROI table** by scenario (curtailable MW / cost-per-event
  assumptions), showing probability-weighted EV for upcoming predicted peaks.
- **“Today's signal” banner** — a standalone component in
  `features/ga-exposure-simulator/components/`, **not tightly coupled to this
  tab's local state** (it's a strong candidate to promote to a shared component
  / alerting layer later). Shows the recommendation and the probability behind it.
- Reuse the shared `customerProfile` (curtailable MW, GA rate assumptions) so the
  storage-optimizer tab (Prompt 2) can later read the same profile.

---

## NON-FUNCTIONAL

- **Correctness first.** Unit-test PDF, break-even, per-CP savings, and the
  meter normalization (units, interval aggregation, net-of-generation, kVA
  derivation, DST alignment) against **hand-worked examples**, and surface those
  worked examples in the PR/output so a human can check them against known-good
  numbers before anyone trusts this for a real exposure decision. No legacy
  spreadsheet exists to validate against, so the worked examples are the ground
  truth — make them explicit.
- Handle missing/partial meter data gracefully and visibly (a gap during a CP
  hour changes the answer — say so).
- Keep the optimizer/ROI functions pure and swappable; keep all business logic
  out of the components.
- Conform to the theme (light + dark), the shared query-key convention, and the
  `features/` folder layout. No second color palette, no ad-hoc `useEffect` +
  `fetch`.
- **Where the ICI spec is ambiguous, STOP and ask** — flag the specific decision
  (PDF denominator, base-period edges, rounding, class-transition timing) rather
  than guessing.

---

## Deliverable

A `features/ga-exposure-simulator/` tab conforming to the contract, with pure
tested `calculations.js`, the meter ingester, the two GA adapters (monthly GA;
peak/AQEW reuse), and the per-CP savings breakdown as the hero feature. Report
any contract deviations and every flagged methodology decision.

---

## SIDEBAR JOB (small, self-contained — NOT part of the GA tab)

A quick fix to the existing **Peak Forecast** tab's confidence wording that can
ride along on this branch. Independent of everything above; do it as a separate
commit.

**Finding — the labels are misleading, the math is not weak.** The number under
the hood is a real calibrated P(top-5) (percentile×lead logistic in
`pipeline/src/peak_probability.js`) — strictly better than the old days-out
heuristic it replaced. What's broken is only the *label mapping*: `confidenceLabel`
gates on **absolute** P(top-5) —

```
>= 0.5 -> moderate,  >= 0.2 -> low,  else very low
```

— but P(top-5) is intrinsically small (only ~5 winners out of dozens of candidate
days per base period), so ~0.5 is nearly unreachable and almost everything lands
in "very low." That collapse is a display artifact, **independent of** the
`accuracyByLead` surrogate-weather weakness (tracked separately in
`docs/prompts/investigate-low-accuracy-by-lead.md`) — do **not** touch the model,
the calibration, or the tau/threshold tuning here. This is a wording change only.

**Decision (owner): relabel off the normalized percentile, 3-rung ladder, drop
"very low" (bad marketing).**

```
peakPercentile >= 0.5 -> High,  >= 0.2 -> Moderate,  else Low   (thresholds tunable)
```

`probabilityFor` **already returns `percentile`** (emitted per peak as
`peakPercentile`), so this is near-trivial — relabel off that percentile instead
of the raw probability. No model change, no retrain.

**Touchpoints:**
- `pipeline/src/peak_probability.js` — `confidenceLabel` (take percentile; add the
  `high` rung, remove `very low`). Keep the days-out fallback in
  `forecast.js:decorate` in sync with the same 3-rung wording.
- `src/features/peak-forecast/calculations.js` — the `CONF` map: add a `high`
  entry (color + bar), drop/repoint `very low`. `PeakCard.jsx` / `PeakTable.jsx`
  read `CONF[p.confidence] ?? CONF.low`, so keep a safe fallback key.
- `src/types/market.js` — update the `Confidence` enum if it lists the values.

**Honesty caveat — do not skip.** A percentile label is *relative*: "High" means
"top-ranked candidate this run," NOT "likely to actually be a top-5 peak" — a
60th-percentile summer day may still be only ~5% to bank a CP. So (a) **keep the
numeric `probability` visible next to the word** (the tab already surfaces it) so
"High (P=6%)" never hides the real number, and (b) anchor the percentile on the
**historical per-lead reference** (what `peakPercentile` already is), not today's
batch, so "High" means the same thing run to run. Fuller ladder is fine for
marketing — but the honest probability stays beside it.
