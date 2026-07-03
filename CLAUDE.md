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

   **Next:** dashboard Tab 3 UI (needs a design decision on how the app reads
   pipeline output — no `public/` folder or serving convention exists yet).

3. (Optional) Adapt Gemini's Vitest serverless-fallback integration test onto a
   dashboard branch — offered, not confirmed. Note: Gemini's draft had wrong
   property names; adapt, don't paste.
