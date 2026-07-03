# EnergyDashboard — project notes for Claude

Two independent deliverables live in this repo:

1. **The dashboard app** (repo root: `src/`, `api/`) — a public-facing Ontario
   electricity-market SPA (React + Vite + Leaflet + Recharts + AG Grid, Tailwind
   dark theme), deployed on Vercel. Live and working.
2. **The peak-prediction pipeline** (`pipeline/`) — a standalone Node data job
   that assembles a multi-year, hourly, time-aligned dataset (demand + weather +
   official ICI peak labels) for backtesting an Ontario **5CP** model. It does
   **not** import or touch the app.

> Branch convention for this workstream: `claude/peak-prediction-pipeline` (data
> pipeline, done — merged) has given way to `claude/peak-prediction-engine`
> (the model + backtest, current work). `main` and
> `claude/ieso-lmp-dashboard-scaffold-2j6b2j` are both fully up to date and
> content-identical as of this branch's creation. Commit with clear messages,
> push with `git push -u origin <branch>`. Don't open PRs unless asked.

---

## Dashboard app — key facts

- **IESO proxy:** `api/ieso.js` (Vercel serverless). Uses host
  **`reports-public.ieso.ca`** (NOT `reports.ieso.ca` — the latter is stale and
  fails). `?report=snapshot|series|nodal`, `?debug=1` for diagnostics.
- **Market Renewal (May 2025):** HOEP retired → Ontario Zonal Price; nodal LMP
  introduced; **9 virtual trading zones** (Bruce merged into Southwest).
  `LMP = energy + congestion + loss`; `basis = LMP − ONZP`.
- **Nodal tab** (`src/components/NodalTab.jsx`): AG Grid pivot, Zone→Type→Node.
  Gotchas already fixed and easy to regress: v32 needs the
  `import 'ag-grid-community'` side-effect to register modules; the grid wrapper
  needs a **definite** height (`h-[70vh] min-h-[420px]`) or it renders blank on
  mobile; every column needs `flex` or price columns overflow off-screen.
- Node→zone map: `api/nodeZones.js` (generated from IESO PUB_NodeZoneMap, ~93%
  coverage). Color scale `src/utils/colorScale.js` (LMP_FLOOR=-50 negative band).

---

## Pipeline (`pipeline/`) — current state

**Output:** `data/peak_dataset.csv` — one row per Eastern hour, columns:
`timestamp, ontario_demand_mw, market_demand_mw, temp_c, dewpoint_c, humidex,
wind_kmh, hour_of_day, day_of_week, month, is_weekend, is_holiday, is_top5_peak,
is_top10_peak`. No price/LMP — peak prediction is demand + weather driven.

**Why Node, not Python:** repo is already Node; `luxon` handles DST/EST cleanly;
`fast-xml-parser` (already a dashboard dep) parses the ICI XML. A Python/pandas
raw-CSV fetcher was proposed and **rejected** — it duplicated tested logic, used
a stale IESO host, pointed at a **decommissioned** ECCC station (bulk `stationID=5097`
= old Pearson `6158733`, data ends 2013), and produced un-aligned CSVs with no
peak labels (forcing the re-rank-raw-demand anti-pattern). Don't reintroduce it.

**Time alignment (the crux):** three clocks — IESO demand is **EPT**
(America/Toronto, DST-aware, hour-ending 1–24); ECCC weather is **LST = EST
year-round, no DST**; ICI peaks are **EST year-round**. Everything joins on a
**UTC hour key** (`utcHourKey`), then `timestamp` is emitted in Eastern wall
time. See `src/lib/time.js`.

**Peak labels — use IESO's ranking, don't re-derive it.** `is_top5/top10` come
from the ICI Peak Tracker year files (`status=Final`, ranked by value), one file
per base period. **Never** sort raw demand to find peaks.

**Config (`src/config.js`), all env-overridable:**
- Weather station: default **Pearson `6158731`** (complete record, reports wind).
  `WEATHER_STATION_ID=6158355` = Toronto City (downtown, no wind).
  `npm run weather:compare` prints a per-station coverage table.
- Date window: default trailing 12 months. `PIPELINE_END=`, `PIPELINE_MONTHS=`,
  `PIPELINE_START=` widen it. **Two base periods:**
  `PIPELINE_START=2024-05-01 PIPELINE_END=2026-04-30` → `PEAK_YEARS=[2024,2025]`.
- Base period = **May 1 – Apr 30, labelled by START year** (`baseYearOf`).

**Network:** `reports-public.ieso.ca` and `api.weather.gc.ca` are **blocked from
the Claude sandbox** — all fetch steps run on the user's machine. Parsers are
validated against fixtures in `docs/Sample-Reports/`.

**Last verified run (2-year window, Pearson):** 21,909 demand rows, 17,519
weather rows (temp/dewpoint/wind ~0% missing, humidex ~82% missing = expected,
summer-only), 17,520 dataset rows spanning 2024-05-01 → 2026-04-30. **2025**
peaks labeled correctly (Jun 24 HE19 24,862 MW, etc.).

---

## Open tasks (pick up here)

1. **✅ Done — 2024 (and earlier) ICI peak labels, fixed via a historical
   fallback** (`pipeline/fixtures/historical_peaks_top5.csv`, consolidated
   AQEW_MWh ranks 1-5 + Demand_MW ranks 6-10 for 2022/2023/2025). Verified
   end-to-end on the user's machine over 2020-05-01 → 2026-04-30. PR:
   https://github.com/farhadquassem-ctrl/EnergyDashboard/pull/4

2. **✅ Peak-prediction engine + backtest v1 — working, on `claude/peak-prediction-engine`.**
   Pipeline-side CLI only so far (`npm run backtest`; `pipeline/src/peak_model.js`
   + `pipeline/src/backtest.js`) — no dashboard UI yet, that's a later, separate
   step now that the model's validated. Consumes `peak_dataset.csv` **directly**
   — does **not** re-rank raw demand.

   **⚠️ Bug found and fixed while building this: every peak label in
   `peak_dataset.csv` was shifted 1 hour late, for every year.** `iciPeakToDateTime`
   (`pipeline/src/lib/time.js`) converted the ICI Peak Tracker's `deliveryHour`
   using a fixed EST (UTC-5) offset, per this file's own prior documentation
   ("ICI Peak Tracker -> EST year-round"). That assumption was wrong: cross-
   referencing 3 independent real peak entries (2022-07-19 HE18, 2023-09-05
   HE17, 2025-06-24 HE19) against `demand.json` showed each source's reported
   peak *value* only matches the demand row when `deliveryHour` is converted
   via the same DST-aware Eastern zone as demand, not fixed EST — despite the
   report XML's own metadata timestamps using a constant -0500 offset. Fixed
   by having `iciPeakToDateTime` reuse `iesoHourEndingToDateTime` directly.
   This silently affected every previous build of `peak_dataset.csv` (task 1
   included) since every real peak in this dataset falls in DST season.

   **Model:** multivariate OLS regression (normal equations, hand-rolled —
   `simple-statistics` has no multivariate/logistic fitting, only 2-variable
   `linearRegression`; used instead for `mean`/`sampleCorrelation` diagnostics)
   predicting `ontario_demand_mw` from `cooling_degrees` (= max(0, temp_c-25)),
   `heating_degrees` (= max(0, 10-temp_c)), `wind_kmh`, `hour_of_day`,
   `is_weekend`, `is_holiday`. Candidates are hard-filtered to **HE11-HE22**
   and **temp_c ≥25°C or ≤10°C** (`peak_model.js`; both thresholds tunable,
   starting points per the user's domain read). Two iterations to get here:
   (1) v1 restricted candidates to June-September to dodge Ontario's bimodal
   demand-vs-month curve (winter heating + summer cooling both raise demand,
   so a single linear `month`/`temp_c` term can't fit both) — worked (R²~0.82)
   but silently wrote off winter, including a real Feb-2023 cold-snap peak.
   (2) Replaced the month filter with degree-based features (non-negative
   distance past each threshold, so both directions of "extreme weather ->
   more demand" get their own coefficient instead of cancelling) — this
   properly includes winter candidates. R² dropped to ~0.53-0.61 (expected:
   Ontario winter heating is still mostly gas furnace, weaker electricity-
   demand link than summer AC — `HEATING_THRESHOLD_C` is expected to matter
   more as heat-pump adoption grows). The Feb-2023 peak now ranks 19th of 272
   candidate days by predicted score — just outside the top-15 cutoff, so
   still not caught, but clearly not noise either.

   **Backtest:** walk-forward / expanding window across the 6 base periods —
   train on base years strictly before the test year (2020 is training-only,
   2021-2025 evaluated). Per test year: predict every candidate hour, rank
   days by their highest-predicted hour, flag the top 15, and for each emit a
   window centered on that day's top hour at 3 widths = **risk profiles**
   (Conservative=3h, Balanced=4h, Aggressive=5h — narrower = less unnecessary
   ICI curtailment cost, wider = safer catch). **Results (2021-2025, with
   winter candidates included):** R² 0.53-0.61; top5/top10 recall inside the
   flagged window 40-100% (Conservative) up to 60-100% (Aggressive); top-10
   predicted-vs-actual overlap 1-4/10. Comparable to the June-Sept-only run
   (R²~0.82, recall 40-100%/78-100%) on recall, worse on R² and overlap — the
   tradeoff for not silently excluding winter.

   **Multi-horizon forecasts (3/7/14-day), added 2026-07:** lead time is now a
   first-class axis, separate from risk profile (window width). New pieces, all
   pipeline-side:
   - `src/forecast_weather.js` — climatology (±7-day-smoothed doy×hour bins) +
     anomaly persistence decaying as `exp(-lead/5d)` (tau env-tunable, **not**
     tuned against recall — the degradation curve must stay honest). Wind =
     climatology only.
   - `src/backtest_horizons.js` (`npm run backtest:horizons`) — walk-forward
     per lead ∈ {0,3,7,14}; lead 0 = v1 baseline. **All leads use the surrogate
     because ECCC publishes no forecast archive** (CaSPAr is gated; documented,
     not fudged) — so 3/7-day results are conservative lower bounds vs. the
     live citypage path. Filters candidates on *forecast* temp (else leakage);
     anomaly reads only obs strictly before issue time. Verified on synthetic
     AR(1) data: recall degrades monotonically 0d→14d as designed. **Real-data
     numbers still need a run on the user's machine.**
   - `src/fetch_forecast.js` (`npm run fetch:forecast`) — live ECCC citypage
     XML (Toronto `s0000458`, `dd.weather.gc.ca/today/citypage_weather/ON/{HH}/`,
     ~7 days out; no public ECCC product reaches 14). ⚠ Written from ECCC's
     published schema + tested only against
     `fixtures/citypage_sample_SYNTHETIC.xml` — host is sandbox-blocked, so the
     **first real-machine run is the verification**; replace the fixture with a
     real capture after. Parser gotcha: attribute-bearing elements
     (`<month name="July">7</month>`) parse to objects — unwrap `#text`.
   - `src/forecast.js` (`npm run forecast`) — **reframed 2026-07 to the 5CP
     consumer view** (was: one target day per lead). ICI consumers are billed
     next year's Peak Demand Factor on their demand during *this* base period's
     (May 1–Apr 30) five Coincident Peaks, so the question is "which upcoming
     hours would crack the base period's **running top-5** and are worth
     curtailing?" Output: `basePeriod`/`billingPeriod` (base 2026 → billed
     Jul 2027–Jun 2028); `running5CP` + `threshold` (top-5 daily peaks banked
     so far, from observed demand — the live running board, which is what the
     ICI Peak Tracker itself publishes mid-period; **not** the re-rank-raw
     anti-pattern, which is about fabricating *Final* labels for a *finished*
     period); `predictedPeaks` (up to 5 upcoming candidate days, ranked, each
     with `daysOut`+`leadBucket` so **3/7/14-day views are nested subsets**,
     `projectedRank` on the board, `wouldRankTop5` = curtail vs monitor).
     Weather+confidence degrade with `daysOut`. Base/billing helpers live in
     `config.js` (`basePeriodBounds`/`billingPeriodBounds`).
   - `src/export_dashboard.js` (`npm run export:dashboard`) — the **one
     sanctioned pipeline→app coupling**: runs the forecast and writes
     `public/peak-forecast/forecast.json` (schemaVersion 1) so the dashboard's
     Peak Forecast tab reads it as a static file (no backend). Carries
     `generatedAt`/`datasetThrough`/`staleNote` for a freshness banner. Commit
     the regenerated JSON. The pipeline branch ships the generator only; the
     committed sample JSON lives on the dashboard side.

   **Next:** Peak Forecast tab is built on the dashboard side (card/table
   toggle, running board + nested predicted peaks). Real numbers need a
   dataset extending to ~now + `export:dashboard` run on the user's machine.

3. (Optional) Adapt Gemini's Vitest serverless-fallback integration test onto a
   dashboard branch — offered, not confirmed. Note: Gemini's draft had wrong
   property names; adapt, don't paste.
