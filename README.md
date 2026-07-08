# EnergyDashboard — IESO market dashboard + 5CP peak pipeline

A public-facing **Ontario electricity market dashboard** (React SPA, deployed on
Vercel) plus a standalone **peak-prediction pipeline** that powers its 5CP peak
forecast. Portfolio project; not affiliated with the IESO.

> 🔌 The dashboard reads **live data from the IESO public reports** via a Vercel
> serverless proxy, and falls back to realistic mock data if the feed is
> unavailable (see [Live data](#live-data-from-the-ieso-public-reports)).

## The two deliverables

1. **The dashboard app** (`src/`, `api/`) — six tabs in two audience sections,
   light/dark theme (dark default, header toggle).

   _Industrial & Commercial_ (Class A / market operators):
   - **Overview** — Ontario map (react-leaflet) with the 7 plotted pricing
     zones colour-coded by **Ontario Zonal Price** on a blue → amber → red
     gradient; 24h Real-Time vs Day-Ahead price chart (Recharts) for the
     selected zone; GA Peak Risk indicator; demand / price / system-condition
     stat bar; Live/Mock status badge.
   - **Nodal** — the full nodal LMP decomposition (900+ pricing nodes) in an
     AG Grid pivot, Zone → Type → Node, with `LMP = energy + congestion +
     loss` and `basis = LMP − OZP` per node (node→zone map served by
     `api/nodeZones.js`).
   - **Peak Forecast** — the ICI 5CP consumer view: the current base period's
     running top-5 board + threshold, upcoming predicted peaks (3/7/14-day
     horizons) with curtail-vs-monitor calls, calibrated P(top-5) per peak,
     and a measured-accuracy panel. A pure renderer of the pipeline's
     exported `public/peak-forecast/forecast.json`.
   - **GA Exposure** — the Class A (ICI) simulator: upload interval meter
     data (client-side only), see your Peak Demand Factor, Class A vs
     Class B GA dollars with the break-even PDF, savings decomposed by
     coincident peak, and probability-weighted curtailment ROI on the live
     forecast.

   _Retail & Homeowner_ (Class B / residential / building managers):
   - **Conservation** — a use-case-organized navigator for Ontario conservation
     and billing programs (Peak Perks, HRSP, EAP, OER, Save on Energy Retrofit,
     GA tracking…), with an interactive **TOU vs. ULO vs. Tiered** rate-plan
     comparator (after the OER credit). Curated from a weekly-refreshed catalog
     (`public/programs/`, kept current by `scripts/programs/` on CI).
   - **Usage Review** — snap phone photos of electricity bills → in-browser OCR
     (Tesseract.js) → structured usage → **anomaly detection** (volume spike,
     on-peak shift, month-over-month/YoY velocity) charted over time. Low-
     confidence reads fall back to a PII-redaction canvas + an ephemeral
     serverless vision route (`api/parse-bill.js`). The anomaly engine is strict
     TypeScript (`analyzeAnomalies.ts`).
2. **The peak-prediction pipeline** (`pipeline/`) — a standalone Node job that
   assembles a multi-year, hourly, time-aligned dataset (IESO demand + ECCC
   weather + official ICI peak labels), fits/backtests the peak model, and
   exports the dashboard's forecast JSON. See `pipeline/README.md`.

> ℹ️ **Note on the renewed market:** Ontario's Market Renewal Program (May 2025)
> retired the single **HOEP** and introduced **nodal LMP** plus per-zone
> **Ontario Zonal Prices (OZP)** across 9 virtual trading zones. The headline
> price tile is the OZP / Ontario Electricity Market Price (OEMP), the
> successor to HOEP.

## Tech stack

| Concern   | Choice                                |
| --------- | ------------------------------------- |
| Framework | React 18 + Vite                       |
| Map       | react-leaflet + Leaflet (OSM tiles)   |
| Charts    | Recharts                              |
| Grid      | AG Grid Community (Nodal tab)         |
| Styling   | Tailwind CSS (`darkMode: 'class'`)    |
| OCR       | Tesseract.js (client-side, Usage Review) |
| Types     | JSDoc app-wide; strict TS for the anomaly engine (`npm run typecheck`) |
| Serverless| Vercel functions (`api/ieso.js`, `api/parse-bill.js`) |
| Pipeline  | Node + luxon + fast-xml-parser        |
| Deploy    | Vercel (production branch: `main`)    |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (http://localhost:5173)
npm run dev

# 3. Unit tests (app; pipeline has its own `npm test` under pipeline/)
npm test

# 4. Production build + local preview
npm run build
npm run preview
```

## Project structure

```
EnergyDashboard/
├── index.html                # App entry (applies the saved theme pre-paint)
├── vercel.json               # Vite framework preset for Vercel
├── api/
│   ├── ieso.js               # Serverless proxy: fetches + parses IESO reports
│   └── nodeZones.js          # Node → zone map (from IESO PUB_NodeZoneMap)
├── public/peak-forecast/     # Pipeline-exported forecast.json + prediction_log.json
├── src/
│   ├── App.jsx               # Header, theme toggle, tab switch
│   ├── theme.jsx             # Light/dark ThemeProvider (dark default)
│   ├── types/market.js       # Shared data model (JSDoc typedefs)
│   ├── lib/ieso/             # One adapter per IESO report family
│   ├── lib/query/            # useMarketQuery — the one sanctioned fetch hook
│   ├── store/marketStore.jsx # Shared UI state (zone, date range, customer profile)
│   ├── components/           # Overview + Nodal + shared chrome (TabShell, PriceChart)
│   ├── features/             # New tabs: index.jsx + hooks.js + calculations.js
│   │   ├── peak-forecast/    #   the reference feature implementation
│   │   └── model-backtest/   #   model-agnostic accuracy scoring
│   ├── data/                 # Zone geography, legacy Overview data hooks, mocks
│   └── utils/colorScale.js   # Price colour mapping
├── pipeline/                 # Standalone peak-prediction data job (own README)
└── docs/                     # ARCHITECTURE.md (tab contract), WORKFLOW.md (git/deploy)
```

**Before adding a tab, read `docs/ARCHITECTURE.md`** — the shared contract for
types, adapters, fetching, state, and folder layout. Git/deploy conventions
live in `docs/WORKFLOW.md`.

## Deploying to Vercel

This repo is preconfigured for Vercel via `vercel.json` (framework preset
`vite`, build command `npm run build`, output `dist`). **`main` is the
production branch** — every push to it auto-deploys. No environment variables
are required.

> **Local dev caveat:** `npm run dev` runs only the Vite frontend, so `/api/ieso`
> isn't served locally — the app will show **Mock data**. The live feed works on
> Vercel (and `vercel dev`), where the serverless function runs. See
> `docs/LOCAL_DEV.md`.

## Live data from the IESO public reports

The IESO publishes free, public market data (no API key) as XML/CSV on
`reports-public.ieso.ca`. Because those files are served without CORS headers,
the browser can't fetch them directly — so a **Vercel serverless function**
(`api/ieso.js`) fetches and parses them server-side and returns clean JSON.

### Data flow

```
browser  →  /api/ieso?report=…  →  reports-public.ieso.ca/*
                 (parse XML/CSV → JSON, normalize, cache)
```

Reports used (field mappings confirmed against `docs/Sample-Reports/` and
verified live):

| Purpose | Report |
| --- | --- |
| Per-zone 5-min price (map colour + chart "This zone" line) | `RealtimeZonalEnergyPrices/PUB_RealtimeZonalEnergyPrices.xml` |
| Province-wide real-time price (headline price tile) | `RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml` |
| Day-ahead hourly price (chart "Day-Ahead" line) | `DAHourlyOntarioZonalPrice/PUB_DAHourlyOntarioZonalPrice.xml` |
| Ontario demand (demand tile + GA risk) | `Demand/PUB_Demand.csv` |
| Nodal LMP decomposition (Nodal tab) | `RealtimeEnergyLMP` + `DAHourlyEnergyLMP` |

Zone names in the price report are virtual-zone hubs (`TORONTO:HUB`,
`NORTHWEST:HUB`, …); we strip `:HUB` and match the 7 plotted zones. The demand
report's header is parsed (not assumed) to locate the `Ontario Demand` column.

### API endpoints (`/api/ieso`)

- `?report=snapshot` → `{ zones:[{id,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }`
- `?report=series&zone=<id>` → `{ series:[{label,zonePrice,dayAhead}], asOf }`
  — a rolling ~24h of 5-min `zonePrice` for the zone, stitched from the hourly
  archive files; `dayAhead` is the province day-ahead cleared price per hour.
- `?report=nodal` → the full nodal LMP table with zone mapping.
- add `&debug=1` to any → diagnostics + the raw parsed report tree(s).

The frontend adapters (`src/lib/ieso/`) call these and **fall back to mock
data** on any failure, so the UI always renders. The header badge shows
Live vs Mock.

### Refresh cadence

Real-time reports update every ~5 minutes. The function sets a 5-minute edge
cache (`s-maxage=300`, stale-while-revalidate), and the client re-fetches the
snapshot every 5 minutes.

### Peak forecast refresh (GitHub Actions)

`.github/workflows/refresh-forecast.yml` runs the full pipeline chain
(fetch → build → backtest → calibrate → forecast → export) on a GitHub runner
**daily at 06:00 ET** (and on manual dispatch), committing the regenerated
`public/peak-forecast/forecast.json` + `prediction_log.json` to `main` only
when they change — which auto-deploys via Vercel. The runner can reach
IESO/ECCC; the Peak Forecast tab's **Refresh** button only re-reads the
published file, it does not regenerate it.

## Known limitations

- **Overview chart spans a rolling ~24h**, stitched from the hourly archive
  files in the `RealtimeZonalEnergyPrices/` directory (there is no single 24h
  report). Stateless — no storage/cron. If the directory autoindex can't be
  read, the chart falls back to just the current hour
  (`?report=series&…&debug=1` shows `usedArchive`).
- **Day-ahead is province-wide**, while the real-time line is per-zone — the
  chart compares a zone's real-time price against the Ontario day-ahead price.
  Per-zone day-ahead would need a zonal day-ahead report.
