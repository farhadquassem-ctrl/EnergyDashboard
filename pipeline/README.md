# Ontario 5CP Peak-Prediction — Data Pipeline

Assembles a **12-month, hourly, time-aligned dataset** for backtesting an Ontario
**5CP (5 Coincident Peaks)** demand/weather model. This is **separate from the
dashboard app** — it doesn't import or touch the React app or `api/ieso.js`.

Output columns (`data/peak_dataset.csv`):

| Column | Source |
| --- | --- |
| `timestamp` (hourly, Eastern, DST-aware) | derived |
| `ontario_demand_mw`, `market_demand_mw` | IESO Hourly Demand Report |
| `temp_c`, `dewpoint_c`, `humidex`, `wind_kmh` | Environment Canada (Toronto) |
| `hour_of_day`, `day_of_week`, `month`, `is_weekend`, `is_holiday` | derived (Ontario stat holidays) |
| `is_top5_peak`, `is_top10_peak` | **IESO ICI Peak Tracker** (official ranking, `status=Final`) |

No price/LMP data — peak prediction is demand + weather driven; price isn't a predictor.

## Why Node (not Python)

The repo is already Node, so there's no second toolchain to install — you can run
this with the same `node` you use for the app. `luxon` handles the DST / EST
conversions cleanly, and `fast-xml-parser` (already used by the dashboard) parses
the ICI XML. pandas would be fine too; Node just keeps it one ecosystem.

## Run it

> **Network:** the fetch steps hit `reports-public.ieso.ca` and
> `api.weather.gc.ca`. Both are **blocked from the Claude Code sandbox**, so run
> these on your own machine (or any server with open egress). The dashboard's
> Vercel functions can reach IESO, but this pipeline is a local/offline job.

```bash
cd pipeline
npm install

# 0. (optional) verify the Toronto weather station coverage first
npm run stations

# 1–3. fetch each source (independent, re-runnable) -> data/*.json
npm run fetch:demand
npm run fetch:weather
npm run fetch:peaks

# 4. join + features + labels -> data/peak_dataset.csv, prints a QA summary
npm run build
```

Each step writes an intermediate to `data/` so you can re-run any one in
isolation. `npm run build` reads the three intermediates and emits the final CSV.

**Two base periods (2024 + 2025) for backtesting.** The default window is a
trailing 12 months (one base period). To cover two full periods — the better
backtest — pin the window to base-period boundaries and re-run every step so the
demand/weather/peak fans all widen together (export the vars once so all four
steps share them):

```bash
export PIPELINE_START=2024-05-01 PIPELINE_END=2026-04-30
npm run fetch:demand && npm run fetch:weather && npm run fetch:peaks && npm run build
```

`fetch:peaks` will then pull both `PUB_ICIPeakTracker_2024.xml` and `_2025.xml`
and label each period's own top-5/top-10 (Git Bash / macOS / Linux `export`; on
Windows PowerShell use `$env:PIPELINE_START='2024-05-01'`).

## Configuration (`src/config.js`)

- **Date window:** trailing 12 months by default. `PIPELINE_END=2026-04-30`
  aligns the end to a complete base period; `PIPELINE_MONTHS=24` widens the
  window to two years; `PIPELINE_START=2024-05-01` pins the start explicitly (see
  the two-base-period recipe above). All downstream year fans follow these dates.
- **Weather station:** default **Toronto Int'l A / Pearson (`6158731`)** — the
  most complete airport record and, unlike downtown, it reports wind; it's also
  the station weather-normalization models weight most heavily. Override without
  editing code: `WEATHER_STATION_ID=6158355 npm run fetch:weather`. Compare
  candidates head-to-head with `npm run weather:compare` (prints per-station
  missing % for each feature). Candidates: `6158731` Toronto Int'l A (Pearson),
  `6158355` Toronto City (downtown load-centroid, no wind), `6158359` Toronto
  City Centre. (The old `6158733` Pearson was decommissioned; its record ends
  2013.)

  **Coverage notes:** Toronto City gives near-complete temperature/dewpoint
  (~0.2% missing) but **no wind** (no downtown anemometer) — the reason Pearson
  is the default. `humidex` is ~80% "missing" at any station — that's expected,
  ECCC only computes it in warm conditions, so it's present during summer peaks
  (what matters) and null otherwise.

## Time alignment (the important part) — `src/lib/time.js`

Three clocks feed the dataset, and mixing them up silently corrupts the peak
labels. We convert **everything to a UTC hour key** to join, then emit the
`timestamp` in Eastern wall time:

| Source | Clock | Notes |
| --- | --- | --- |
| IESO demand | **EPT** (America/Toronto, **DST-aware**) | `Hour` is hour-ending 1–24 |
| ECCC weather | **LST = EST year-round (no DST)** | classic off-by-one trap |
| ICI Peak Tracker | **EST year-round**, base period May 1 – Apr 30 | `status=Final` only |

Because weather is LST and demand is EPT, the *same wall-clock hour* maps to
different absolute times in summer — joining on UTC (not wall-clock) is what makes
demand and weather line up correctly.

## Labels: use IESO's ranking, don't re-derive it

`is_top5_peak` / `is_top10_peak` come from the ICI Peak Tracker year files
(`status=Final`, ranked by value), **not** from sorting the raw demand series.
Self-ranking risks subtle mismatches (denominator, revision status, the
EST-year-round hour boundary) that would quietly corrupt every backtest metric.

## Known caveats / v1 scope

- **Forecast vs. actual:** an honest backtest predicts using the demand *forecast*
  available before the peak (IESO Adequacy Report). v1 uses *actual* demand as the
  signal; add forecast-based evaluation as a refinement (noted, not built).
- **Missing weather hours:** left blank and counted in the QA summary — no
  interpolation in v1 (add linear fill if the gaps matter for your model).
- **Storage:** not included; the Gen-Output-by-Fuel storage series is known
  incomplete (IESO excludes some storage from "Other"), and there's no public
  state-of-charge feed. Optional future feature.
- **`data/schema_sample.csv`** in this repo is **illustrative** (a few rows with
  synthetic weather/label values) to show the exact output shape. The real dataset
  is produced by running the steps above and lands at `data/peak_dataset.csv`
  (gitignored).
