# EnergyDashboard — project notes for Claude

Two independent deliverables live in this repo:

1. **The dashboard app** (repo root: `src/`, `api/`) — a public-facing Ontario
   electricity-market SPA (React + Vite + Leaflet + Recharts + AG Grid, Tailwind
   dark theme), deployed on Vercel. Live and working.
2. **The peak-prediction pipeline** (`pipeline/`) — a standalone Node data job
   that assembles a multi-year, hourly, time-aligned dataset (demand + weather +
   official ICI peak labels) for backtesting an Ontario **5CP** model. It does
   **not** import or touch the app.

> Branch convention: **`main` is the single source of truth — GitHub's default
> branch AND Vercel's production branch** — every commit to it auto-deploys. Do
> work on a fresh `claude/<topic>` branch off `main`, commit with clear messages,
> push with `git push -u origin <branch>`, and merge to `main` (that push is the
> deploy). Don't open PRs unless asked. **Full git/deploy playbook: `docs/WORKFLOW.md`.**
>
> The old `claude/ieso-lmp-dashboard-scaffold-2j6b2j` default and the merged
> feature branches (`peak-prediction-pipeline`, `peak-prediction-engine`,
> `peak-forecast-tab`, `dashboard-theme-toggle`, `nodal-lmp-grid`) are retired;
> each is preserved as an `archive/<topic>` branch. Token constraints: the
> session's GitHub token can push to `refs/heads/*` (branches) but **cannot push
> tags or delete any ref** (both 403). Create refs via the GitHub MCP
> `create_branch` (App auth); delete branches and change repo settings (e.g. the
> default branch) from the GitHub UI.

---

## Dashboard app — key facts

- **Two audience sections (`App.jsx`):** _Industrial & Commercial_ (Overview,
  Nodal, Peak Forecast, GA Exposure) and _Retail & Homeowner_ (Conservation
  Navigator, Usage Review). Same tab contract; grouped nav only.
- **Retail/Homeowner section (Class B / residential), shipped:**
  - **Conservation Navigator** (`src/features/conservation-navigator/`) — curated,
    use-case-organized program catalog + a TOU/ULO/Tiered rate comparator (after
    OER). Static JSON in `public/programs/` (adapter `src/lib/programs.js`),
    refreshed **weekly** by `scripts/programs/refresh.mjs` (DOM-diff scraper of
    Save on Energy pages; runs on CI via `.github/workflows/refresh-programs.yml`
    — the sandbox can't reach those hosts). The scraper **detects + dates**
    changes and flags programs; it deliberately does **not** auto-rewrite curated
    copy (rebate nuance → human-in-the-loop). Rates JSON is ILLUSTRATIVE until an
    OEB feed URL is wired (`OEB_RATES_URL`).
  - **Usage Review** (`src/features/usage-review/`) — bill photo → OCR → anomaly
    detection. **`analyzeAnomalies.ts` is strict TypeScript** (spec mandate) — the
    one scoped TS exception in a JSDoc repo (`tsconfig.json`, `npm run typecheck`;
    tests run via Node 22 type-stripping). Phase 1 client OCR (Tesseract.js, lazy);
    Phase 2 fallback = canvas PII-redaction → **`api/parse-bill.js`** (Claude
    vision, `VISION_MODEL` env, default Sonnet). ⚑ **Ephemerality is a
    non-negotiable**: that route writes nothing and logs nothing derived from the
    image/PII — preserve both if you touch it. Dormant (501) until
    `ANTHROPIC_API_KEY` is set; OCR path works without it. Engine runs on
    daily-average kWh; Check-3 velocity switches to YoY (N−12) at ≥12 bills so
    seasonal swings don't false-trigger.
- **Shared architecture contract (read before adding any tab): `docs/ARCHITECTURE.md`.**
  Types in `src/types/market.js` (JSDoc, not TS); all IESO fetching/parsing in
  `src/lib/ieso/` adapters; one fetch hook `src/lib/query/useMarketQuery.js`
  (query key `[market, zone, dateRange]`); global UI state in
  `src/store/marketStore.jsx`; page chrome via `src/components/TabShell.jsx`;
  new tabs live at `src/features/<tab-name>/` (`index.jsx` + `hooks.js` + pure
  `calculations.js` + `components/` — `features/peak-forecast/` is the
  reference). Known deviations are listed in that doc — they're deliberate;
  don't "fix" them in passing.
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
- **Peak Forecast tab** (`src/features/peak-forecast/`, 3rd tab): the ICI
  5CP consumer view. Pure renderer of the pipeline's exported
  `public/peak-forecast/forecast.json` (fetched at runtime via
  `src/lib/ieso/peakForecast.js`; no API). Shows the current base period's
  running top-5 board + threshold, and up to 5 upcoming curtailment targets
  (predicted peaks that would crack the top-5), filterable by horizon (3/7/14d,
  a nested subset) with a **Cards/Table view toggle**. A committed sample JSON
  (`sample:true`) ships so it renders before any real pipeline run; the pipeline
  `npm run export:dashboard` overwrites it. Base vs billing period is surfaced
  (base 2026 → bills Jul '27–Jun '28). Both themes; curtailment strip uses
  semi-transparent amber (theme-agnostic).
- **Theme toggle** (`src/theme.jsx` + header button): light/dark via Tailwind
  `darkMode:'class'`; **dark stays the hard default** (localStorage `theme`,
  OS preference deliberately ignored; index.html applies the class pre-paint).
  Light values are the unprefixed classes, dark under `dark:`. JS-level colors
  (not classes) are themed separately — AG Grid (`ag-theme-quartz[-dark]` +
  CSS-var sets, grid remounts on theme via `key`), Recharts axis/grid/legend,
  Leaflet marker neutral/stroke; the map tile dark-inversion filter is gated
  under `.dark` in index.css. Adding a new component? Every hardcoded dark
  class needs a light counterpart, and raw-color props need `useTheme()`.

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

## Build log — all shipped, merged to `main`, and live

Everything below is **done and deployed**. Production branch is now **`main`**
(Vercel deploys it; the old `claude/ieso-lmp-dashboard-scaffold-2j6b2j` mainline
and the merged feature branches were retired). Kept here as reference for the
*why*, not as a checklist. **Next steps: TBD** — to be repopulated once the
first live-data forecast run lands (see the one outstanding item at the end of
§2).

1. **✅ Done — 2024 (and earlier) ICI peak labels, fixed via a historical
   fallback** (`pipeline/fixtures/historical_peaks_top5.csv`, consolidated
   AQEW_MWh ranks 1-5 + Demand_MW ranks 6-10 for 2022/2023/2025). Verified
   end-to-end on the user's machine over 2020-05-01 → 2026-04-30. PR:
   https://github.com/farhadquassem-ctrl/EnergyDashboard/pull/4

2. **✅ Peak-prediction engine + backtest + Peak Forecast tab — shipped & live.**
   Model + backtest CLI (`npm run backtest`; `pipeline/src/peak_model.js`
   + `pipeline/src/backtest.js`) and the dashboard tab that renders its exported
   output are all merged to `main` and deployed. Consumes `peak_dataset.csv`
   **directly** — does **not** re-rank raw demand.

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

   **✅ Live data + self-refresh — done.** The first real forecast run landed
   (`public/peak-forecast/forecast.json`, `sample:false`), so the tab now renders
   real numbers and shows a green **Live** pill (amber **Sample data** pill only
   for the checked-in sample; see `src/features/peak-forecast/index.jsx` header). Freshness is now
   automated: **`.github/workflows/refresh-forecast.yml`** runs the full chain
   (`fetch:demand → fetch:weather → fetch:peaks → build → backtest:horizons →
   calibrate → fetch:forecast → export:dashboard → log:predictions`) on a GitHub
   runner **daily at 06:00 ET** and on manual dispatch, committing `forecast.json`
   + `prediction_log.json` to `main` only when they change → Vercel auto-deploys.
   The runner can reach IESO/ECCC (the Claude sandbox cannot), so this is the one
   place the live fetch chain runs unattended. The header **Refresh** button still
   just re-reads the published file client-side (it does not regenerate — that's
   the workflow's job). Scheduled runs require the workflow to sit on the
   **default** branch (`main`) — satisfied.

   **✅ accuracyByLead near-zero — root-caused 2026-07, reframed not tuned.**
   The first live `accuracyByLead` (mean ~3%, 14d = 0) triggered a diagnosis
   (`docs/prompts/investigate-low-accuracy-by-lead.md`). Verdict, from a
   `diagnose_only` CI run on real 2020-2026 data: **H1 dominant** (surrogate
   weather can't rank the specific peak day: pooled day-recall 93%→7% from
   lead 0→3d), H3 secondary (~half of CP hours fail the temp gate under
   surrogate temps), H5 real (29 positives / 6 yrs), **H2/H6 ruled out**
   (lead-0 reproduces the v1 40-100% baseline; day-recall ≈ windowed recall).
   Frame A confirmed: the ~1% live P(top-5) is correct (7/14d logistic slopes
   are ≈0/negative — no signal in the surrogate percentile, so base rate).
   Shipped the honest reframe: forecast.json schemaVersion 2 (`pooled` counts
   + `top5DayRecall` per lead, `accuracyBaseline` = lead-0 ceiling), and the
   AccuracyPanel anchored on the known-weather ceiling bar with "14-day ≈ 0%
   by design" captions. Nothing tuned (tau/thresholds/windows untouched).
   Full table + verdict: `docs/findings/accuracy-by-lead-2026-07.md`.

   **Peak probability + accuracy tracker (Prompts 3 dep + 5).**
   - `src/peak_probability.js` (`npm run calibrate`) — calibrated **P(top-5)**
     replacing the old days-out `confidence` heuristic: empirical
     percentile×forecast-lead model (logistic, fit from the walk-forward
     backtest), emitted per predicted peak in `forecast.json` as `probability`.
     Writes `data/peak_probability.json` + a self-contained
     `data/calibration_report.html` (logistic vs isotonic vs buckets — the
     fit-form visual compare; **logistic** is locked). Running-board
     "days-remaining" percentiling is the deferred v2.
   - `src/prediction_log.js` (`npm run log:predictions`) — the durable
     **prospective** prediction log (`public/peak-forecast/prediction_log.json`,
     shape `ModelPrediction`). Appends each run's predictions, resolves past ones
     (actualValue when the day passes; `actualHit` only at base-period close).
     This is the log that didn't exist before — accuracy was ONLY the recomputed
     backtest. Model-agnostic scoring: `src/features/model-backtest/calculations.js`
     (`computeHitRate`/`computeCalibration`/`computeTrendOverTime`). **Decision:
     accuracy stays embedded in Peak Forecast, model-agnostic underneath — not a
     standalone tab** (premature with one model). See `docs/ARCHITECTURE.md §8`.
   - Both app and pipeline now have `npm test` (`node --test`).

3. (Optional) Adapt Gemini's Vitest serverless-fallback integration test onto a
   dashboard branch — offered, not confirmed. Note: Gemini's draft had wrong
   property names; adapt, don't paste.
