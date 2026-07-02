# EnergyDashboard — project notes for Claude

Two independent deliverables live in this repo:

1. **The dashboard app** (repo root: `src/`, `api/`) — a public-facing Ontario
   electricity-market SPA (React + Vite + Leaflet + Recharts + AG Grid, Tailwind
   dark theme), deployed on Vercel. Live and working.
2. **The peak-prediction pipeline** (`pipeline/`) — a standalone Node data job
   that assembles a multi-year, hourly, time-aligned dataset (demand + weather +
   official ICI peak labels) for backtesting an Ontario **5CP** model. It does
   **not** import or touch the app.

> Branch convention for this workstream: develop on
> `claude/peak-prediction-pipeline`, commit with clear messages, push with
> `git push -u origin <branch>`. Don't open PRs unless asked.

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

1. **⚠️ 2024 ICI peak labels are missing.** The 2-year run labeled 2025 peaks
   but got `2024: 5 datapoints, 0 Final -> top5=0 top10=0`. Root cause is almost
   certainly that `PUB_ICIPeakTracker_2024.xml` is **pre-Market-Renewal** and
   uses a different `datapointName`/`status` convention, so `extractDatapoints`
   (`src/fetch_peaks.js`) falls through its `?? datasets[0]` fallback onto the
   wrong dataset. **Next:** get the real `PUB_ICIPeakTracker_2024.xml` (user
   pulls it locally → `docs/Sample-Reports/`), inspect its dataset names +
   status vocabulary, and generalize the parser (and/or drop pre-MR base years
   from the default backtest window). Until fixed, only the 2025 base period is
   labeled — a two-period backtest can't validate on 2024.

2. **Tab 3 — Peak Prediction backtest/validation module** (not started, paused
   at user's request). Consume `peak_dataset.csv` **directly** (already aligned +
   labeled) — do **not** re-rank raw demand. Honest backtest note: v1 uses
   *actual* demand as the signal; a real forecast-based eval (IESO Adequacy
   Report) is a documented future refinement.

3. (Optional) Adapt Gemini's Vitest serverless-fallback integration test onto a
   dashboard branch — offered, not confirmed. Note: Gemini's draft had wrong
   property names; adapt, don't paste.
