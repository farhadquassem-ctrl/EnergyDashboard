# EnergyDashboard — Technical Specification

A comprehensive technical reference for the EnergyDashboard platform: a
public-facing Ontario electricity-market observability app plus a standalone
peak-prediction data pipeline. This document is the "enhanced README" — the
single place that describes *what the system is made of and how it runs.*

- Product design rationale → [`DESIGN.md`](./DESIGN.md)
- Per-tab architecture contract → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Git / deploy playbook → [`WORKFLOW.md`](./WORKFLOW.md)
- End-user instructions → [`collateral/EnergyDashboard-User-Manual.pdf`](./collateral/EnergyDashboard-User-Manual.pdf)

---

## 1. System overview

EnergyDashboard is two independent deliverables in one repository:

1. **The dashboard app** (`src/`, `api/`) — a React SPA deployed on Vercel,
   with a thin serverless proxy for the IESO public reports. Six feature
   tabs in two audience sections.
2. **The peak-prediction pipeline** (`pipeline/`) — a standalone Node data
   job that assembles a multi-year, hourly, time-aligned dataset (IESO
   demand + ECCC weather + official ICI peak labels), fits and backtests a
   5CP peak model, and exports the JSON the dashboard's Peak Forecast tab
   renders. The pipeline does not import the app.

```
EnergyDashboard/
├── api/                       # Vercel serverless functions
│   ├── ieso.js                #   IESO report proxy (XML/CSV → JSON)
│   ├── nodeZones.js           #   node → zone map (PUB_NodeZoneMap)
│   └── parse-bill.js          #   ephemeral bill-vision fallback (Usage Review)
├── public/
│   ├── peak-forecast/         #   pipeline-exported forecast.json + prediction_log.json
│   └── programs/              #   conservation catalog + illustrative rates (weekly-refreshed)
├── src/
│   ├── App.jsx                #   grouped-nav shell, tab state (kept-mounted panes)
│   ├── theme.jsx              #   light/dark provider (dark default)
│   ├── types/market.js        #   shared data model (JSDoc typedefs)
│   ├── lib/ieso/              #   one adapter per IESO report family
│   ├── lib/query/             #   useMarketQuery — the one sanctioned fetch hook
│   ├── store/marketStore.jsx  #   shared UI state (zone, range, customer profile)
│   ├── components/            #   Overview + Nodal + shared chrome (TabShell, PriceChart)
│   └── features/              #   feature tabs (index.jsx + hooks.js + calculations.js + components/)
├── pipeline/                  #   standalone peak-prediction job (own README + tests)
├── scripts/programs/          #   weekly conservation-catalog refresh (DOM-diff scraper)
└── .github/workflows/         #   refresh-forecast.yml (daily), refresh-programs.yml (weekly)
```

## 2. Technology stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **React 18 + Vite** | SPA; tabs are `useState`-switched, not routed |
| Language | **JavaScript + JSDoc** | one scoped exception: the strict-TS anomaly engine |
| Map | **react-leaflet + Leaflet** | OSM tiles; dark-mode tile inversion via CSS filter |
| Charts | **Recharts** | price curves, TOU stacked bars, accuracy panel |
| Grid | **AG Grid Community** | Nodal tab pivot (Zone → Type → Node) |
| Styling | **Tailwind CSS** | `darkMode: 'class'`; dark is the hard default |
| OCR | **Tesseract.js** | client-side, lazy-loaded (~2 MB kept out of main bundle) |
| Types | **JSDoc** app-wide; **strict TS** for `analyzeAnomalies.ts` | `npm run typecheck` (tsc --noEmit) |
| Serverless | **Vercel Functions** | `api/ieso.js`, `api/nodeZones.js`, `api/parse-bill.js` |
| Pipeline | **Node + luxon + fast-xml-parser** | DST-correct time alignment; XML parsing |
| Tests | **`node --test`** | app + pipeline; ~69 app unit tests |
| CI/CD | **GitHub Actions + Vercel** | nightly/weekly data refresh; push-to-`main` deploy |

## 3. Feature tabs

### Industrial & Commercial (Class A)
- **Overview** — Ontario map (react-leaflet) of the 7 plotted pricing zones
  colour-coded by Ontario Zonal Price; 24h Real-Time vs Day-Ahead price
  chart for the selected zone; GA peak-risk indicator; demand / price /
  system-condition stat bar; Live/Mock badge.
- **Nodal** — full nodal LMP decomposition (900+ nodes) in an AG Grid pivot,
  Zone → Type → Node, with `LMP = energy + congestion + loss` and
  `basis = LMP − OZP` per node.
- **Peak Forecast** — the ICI 5CP consumer view: the current base period's
  running top-5 board + threshold, up to 5 upcoming predicted peaks
  (3/7/14-day horizons, Cards/Table toggle) with curtail-vs-monitor calls,
  calibrated P(top-5) per peak, and a measured-accuracy-by-lead panel. Pure
  renderer of `public/peak-forecast/forecast.json`.
- **GA Exposure** — the Class A simulator: upload interval meter data
  (client-side only), compute Peak Demand Factor, Class A vs Class B GA
  dollars with the break-even PDF, savings decomposed per coincident peak,
  and probability-weighted curtailment ROI on the live forecast.

### Retail & Homeowner (Class B)
- **Conservation** — a use-case-organized navigator for Ontario conservation
  and billing programs, plus an interactive **TOU vs ULO vs Tiered** rate
  comparator (after the OER credit). Curated from a weekly-refreshed catalog
  in `public/programs/`.
- **Usage Review** — bill photo → in-browser OCR (Tesseract.js) → structured
  usage → **anomaly detection** (volume spike, on-peak shift, MoM/YoY
  velocity) charted over time. Low-confidence reads fall back to a
  PII-redaction canvas + the ephemeral vision route. The anomaly engine is
  strict TypeScript (`analyzeAnomalies.ts`).

## 4. Live market data (`api/ieso.js`)

The IESO publishes free, public, key-less market data as XML/CSV on
`reports-public.ieso.ca`. Those files carry no CORS headers, so the browser
can't fetch them directly — a Vercel serverless function fetches and parses
them server-side and returns clean JSON.

```
browser → /api/ieso?report=… → reports-public.ieso.ca/*
                (parse XML/CSV → JSON, normalize, edge-cache)
```

| Endpoint | Returns |
| --- | --- |
| `?report=snapshot` | `{ zones:[{id,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }` |
| `?report=series&zone=<id>` | rolling ~24h of 5-min `zonePrice` + hourly `dayAhead` |
| `?report=nodal` | full nodal LMP table with zone mapping |
| `&debug=1` | diagnostics + raw parsed report tree(s) |

**Reports consumed:** RealtimeZonalEnergyPrices, RealtimeOntarioZonalPrice,
DAHourlyOntarioZonalPrice, Demand (CSV), RealtimeEnergyLMP + DAHourlyEnergyLMP
(nodal). Front-end adapters in `src/lib/ieso/` call these and **fall back to
realistic mock data on any failure**, so the UI always renders; the header
badge shows Live vs Mock. Real-time reports refresh ~every 5 min; the
function sets a 5-minute edge cache (`s-maxage=300`, stale-while-revalidate).

> **Market Renewal (May 2025):** Ontario retired the single HOEP and
> introduced nodal LMP plus per-zone Ontario Zonal Prices (OZP) across 9
> virtual trading zones (Bruce merged into Southwest). The headline tile is
> the OZP / Ontario Electricity Market Price, HOEP's successor.

## 5. The peak-prediction pipeline (`pipeline/`)

**Output:** `data/peak_dataset.csv` — one row per Eastern hour:
`timestamp, ontario_demand_mw, market_demand_mw, temp_c, dewpoint_c,
humidex, wind_kmh, hour_of_day, day_of_week, month, is_weekend, is_holiday,
is_top5_peak, is_top10_peak`. Demand + weather driven; no price.

**Time alignment (the crux).** Three clocks are reconciled on a UTC hour
key, then emitted in Eastern wall time:
- IESO demand — EPT (America/Toronto, DST-aware, hour-ending 1–24)
- ECCC weather — LST (EST year-round, no DST)
- ICI peaks — EST year-round

**Peak labels** come from IESO's official ICI ranking (`status=Final`), never
re-derived by sorting raw demand.

**Model.** Multivariate OLS (hand-rolled normal equations) predicting
`ontario_demand_mw` from `cooling_degrees` (max(0, temp−25)),
`heating_degrees` (max(0, 10−temp)), `wind_kmh`, `hour_of_day`,
`is_weekend`, `is_holiday`. Candidates hard-filtered to HE11–HE22 and
temp ≥25 °C or ≤10 °C. Degree-based features capture Ontario's *bimodal*
demand curve (summer cooling + winter heating both raise demand).

**Backtest.** Walk-forward / expanding window across base periods (train on
years strictly before the test year). Per test year: predict every candidate
hour, rank days by their highest-predicted hour, flag the top 15, and emit
3 window widths as **risk profiles** (Conservative 3h / Balanced 4h /
Aggressive 5h). Multi-horizon (0/3/7/14-day lead) is a separate axis from
window width; all leads use a weather **surrogate** (climatology + decaying
anomaly persistence) because ECCC publishes no forecast archive — so 3/7-day
results are honest lower bounds vs. the live citypage path.

**Calibration.** `peak_probability.js` fits a logistic
percentile × forecast-lead model from the walk-forward backtest, emitting a
calibrated **P(top-5)** per predicted peak. A prospective
`prediction_log.json` records each run's predictions and resolves them as
reality arrives; scoring (`computeHitRate` / `computeCalibration` /
`computeTrendOverTime`) is model-agnostic.

**The one sanctioned coupling.** `npm run export:dashboard` runs the forecast
and writes `public/peak-forecast/forecast.json` (schemaVersion 2), which the
dashboard reads as a static file — no backend.

> **Network:** `reports-public.ieso.ca` and `api.weather.gc.ca` are
> unreachable from the sandbox; all live fetch steps run on CI (a GitHub
> runner) or the maintainer's machine. Parsers are validated against
> fixtures in `docs/Sample-Reports/`.

## 6. Security & privacy model

Privacy is enforced structurally, not by policy alone:

- **GA Exposure & Usage Review are client-only.** Uploaded interval CSVs and
  OCR'd bill data live in React state; the feature code has zero network,
  storage, or analytics sinks. Business logic is pure functions in
  `calculations.js` / `analyzeAnomalies.ts`.
- **`api/parse-bill.js` is ephemeral by mandate.** The Phase-2 low-confidence
  fallback sends a *PII-redacted* image to a vision model, parses it in
  memory, returns structured JSON, and terminates. It **writes nothing and
  logs nothing derived from the image or parsed PII** — only status-class
  diagnostics. `Cache-Control: no-store`. Dormant (HTTP 501) until
  `ANTHROPIC_API_KEY` is set; the client OCR path works without it.
- **No accounts, no user-data store, no third-party analytics.** There is no
  server-side persistence of any user-supplied energy data anywhere.

## 7. Build, test, deploy

```bash
npm install          # dependencies
npm run dev          # Vite dev server (http://localhost:5173) — /api is mock-only locally
npm test             # node --test  (unit tests, app)
npm run typecheck    # tsc --noEmit (strict TS for the anomaly engine)
npm run build        # production build → dist/
npm run preview      # serve the production build locally
```

- **Deploy.** Vercel; `main` is the production branch — every push
  auto-deploys. `vercel.json` pins the Vite preset (build `npm run build`,
  output `dist`). No environment variables are required to run; the vision
  fallback activates only when `ANTHROPIC_API_KEY` (+ optional `VISION_MODEL`)
  are set.
- **Data refresh (CI runs what the sandbox can't).**
  - `.github/workflows/refresh-forecast.yml` — daily 06:00 ET (+ manual):
    runs the full pipeline chain and commits `forecast.json` +
    `prediction_log.json` to `main` when they change → auto-deploy.
  - `.github/workflows/refresh-programs.yml` — weekly (Mon): DOM-diff scrapes
    the Save on Energy / OEB program pages, dates any substantive change, and
    commits the refreshed catalog. Guards against soft-404s (pages served
    "not found" with HTTP 200) so dead links never get baselined.

## 8. Testing & correctness posture

- **~69 app unit tests + 20 pipeline tests** (`node --test`), plus a clean
  `tsc --noEmit` typecheck gate for the anomaly engine.
- **Pure-function core.** All business logic (GA dollars, anomaly detection,
  rate-plan costs, forecast filtering, DOM-diff hashing) lives in
  React-free, unit-tested modules.
- **Honest fallbacks are tested paths, not afterthoughts** — mock market
  data, partial-meter-coverage annualization, low-confidence OCR handoff,
  and soft-404 scraper skips all have explicit handling and tests.
- **Full-app verification** is done by driving the production build in
  headless Chromium across all six tabs, both themes, desktop + mobile
  (375 px), asserting zero console errors and no horizontal overflow.

## 9. Known limitations

- **Overview chart spans a rolling ~24h** stitched from hourly archive
  files (no single 24h report exists); falls back to the current hour if the
  directory index can't be read.
- **Day-ahead is province-wide** while the real-time line is per-zone — the
  chart compares a zone's RT price against the Ontario day-ahead price.
- **Rate figures are illustrative** (badged as such) until a stable OEB feed
  URL is wired; TOU/ULO/Tiered structure is correct, the cents are reference
  points.
- **14-day-ahead forecast skill ≈ base rate by design** — with no real
  weather forecast that far out, the model can't name the specific peak day;
  the UI states this rather than hiding it.

---

*Portfolio project · not affiliated with the IESO, OEB, or any utility ·
all market data is public.*
