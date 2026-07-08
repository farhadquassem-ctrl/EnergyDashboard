# Shared architecture contract (dashboard app)

The contract every new feature tab builds on (established before the DA/RT
arbitrage, storage optimizer, GA exposure simulator, congestion, and
backtesting tabs). The existing tabs (Overview, Nodal, Peak Forecast) were
refactored to conform **without behavior changes**; deviations from the
original contract spec are listed at the bottom — they are deliberate.

## 1. Data model — `src/types/market.js`

JSDoc typedefs (not `.ts` — see deviations): `IntervalPrice`,
`DemandInterval`, `GAForecast`, `PricePoint`, `NodalPriceComponent`, plus the
`MARKETS` list and `toPricePoints()` (pivots `IntervalPrice[]` →
`PricePoint[]` chart rows). Every price row crossing a module boundary is an
`IntervalPrice`; every chart consumes `PricePoint` rows. Tabs must not invent
their own price-row shapes.

## 2. Data access — `src/lib/ieso/`

One adapter per IESO public report family; **no market-data parsing outside
this folder**. Adapters resolve renderable data (live, or mock fallback with
`isLive:false`) and expose normalizers to the shared types.

| module | report family | status |
| --- | --- | --- |
| `snapshot.js` | RT zonal prices + Ontario demand (`?report=snapshot`) | live |
| `zonalSeries.js` | 24h RT 5-min series w/ DA hourly overlay (`?report=series`) | live |
| `nodal.js` | full nodal LMP decomposition (`?report=nodal`) | live |
| `peakForecast.js` | GA 5CP forecast (static `public/peak-forecast/forecast.json`) | live |
| `predictionLog.js` | prospective `ModelPrediction[]` log (static `public/peak-forecast/prediction_log.json`) | live (accruing) |
| `dayAhead.js` | standalone DA range fetch by zone | stub (Prompt 1) |
| `operatingReserve.js` | OR price/volume | stub |
| `historicalDemand.js` | historical demand + official 5CP determination | stub (prefer pipeline static-JSON exports) |

## 3. Fetching — `src/lib/query/useMarketQuery.js`

The one sanctioned client-side fetch pattern, keyed by the contract's
`[market, zone, dateRange]` convention (`marketQueryKey`). Handles initial
load, key-change refetch, interval auto-refresh (background, no flicker),
manual `refresh({ bustCache })`, and keep-last-good-data on failed refresh.
No ad hoc `useEffect` + `fetch` in tabs.

## 4. State — `src/store/marketStore.jsx`

Context + `useState` (matching `theme.jsx`): `selectedZoneId`, `dateRange`,
`customerProfile` (default `{ mw: 1 }`). Tabs read these instead of
duplicating local state for the same concept. Battery params (storage
optimizer) and GA-class fields extend this store when those tabs land.

## 5. UI shell — `src/components/TabShell.jsx` + `PriceChart.jsx`

`<TabShell title subtitle actions>` is every tab's page chrome, with
`TabLoading` / `TabError` / `TabEmpty` states. `<PriceChart>` is the shared
chart: pass `data` (`PricePoint[]`) or `intervals` (`IntervalPrice[]`,
pivoted internally) plus `series` descriptors; defaults reproduce the
Overview RT/DA pair.

## 6. Design tokens

The existing Tailwind theme (zinc scale, `canvas`/`panel`/`panelMuted`, dark
via `darkMode:'class'`). No second palette. Every hardcoded dark class needs
a light counterpart; raw-color props (Recharts/AG Grid/Leaflet) go through
`useTheme()`.

## 7. Folder structure — `src/features/<tab-name>/`

New tabs: `index.jsx` + `hooks.js` + `calculations.js` (pure functions, no
React — all business logic lives here, unit-testable) + `components/`.
`features/peak-forecast/` is the reference implementation.

Unit tests are `*.test.js` (or `*.test.ts`) next to the code, run with
`npm test` (`node --test`) — both app (`features/model-backtest`) and pipeline.

Current feature tabs, grouped into two audience sections in `App.jsx`:
- _Industrial & Commercial_: `overview`, `nodal`, `peak-forecast`, `ga-exposure-simulator`.
- _Retail & Homeowner_: `conservation-navigator` (curated program catalog +
  rate comparator; static JSON in `public/programs/`, adapter `lib/programs.js`,
  weekly-refreshed by `scripts/programs/` on CI) and `usage-review` (bill OCR +
  the strict-TS anomaly engine; Phase-2 fallback via the ephemeral
  `api/parse-bill.js` vision route — no image or PII is ever persisted/logged).

## 8. Model accuracy — `src/features/model-backtest/`

Model-agnostic accuracy scoring (Prompt 5). `calculations.js` scores any
model's prospective `ModelPrediction[]` log — `computeHitRate` (recall/
precision at a probability threshold), `computeCalibration` (reliability-
diagram bins + Brier), `computeTrendOverTime` (rolling Brier/MAE) — plus the
presentation helpers the Peak Forecast accuracy panel was refactored onto
(`leadRecall`/`recallColorClass`, byte-identical output).

Two accuracy sources, kept separate on purpose:
- **Backtest aggregate** (`accuracyByLead` in `forecast.json`) — walk-forward
  recall recomputed from history each run; what the panel renders today.
- **Prospective log** (`prediction_log.json`, shape `ModelPrediction`) — the
  durable record the pipeline appends each run (`npm run log:predictions`) and
  resolves as reality arrives. The generalized scorers run on this; it accrues
  over time and lags (a 5CP outcome is only final at the base period's close).

**Decision (flagged, per Prompt 5): accuracy stays embedded in Peak Forecast,
not a standalone tab.** With one production model, a separate tab is premature
UI. The module + schema are model-agnostic underneath, so adding a second
model's tracking is a data-plumbing change, not a UI rebuild.

## Deviations from the contract spec (deliberate)

1. **JSDoc, not TypeScript — with one scoped exception.** The repo is plain JS;
   typedefs in `types/market.js` convert 1:1 to `types/market.ts` if TS is
   adopted wholesale. The **Usage Review** anomaly engine
   (`features/usage-review/*.ts`) is the exception: its spec mandates strict TS
   with no `any`, so it introduced a scoped `tsconfig.json` (strict, `noEmit`)
   and `npm run typecheck`. Vite/esbuild transpiles the `.ts` in the bundle;
   Node 22's native type-stripping runs the `.test.ts` files under `npm test`.
   The rest of the app stays JSDoc-JS.
2. **No React Query/SWR.** The contract said "pick whichever the GA tool
   already uses" — it used neither. `useMarketQuery` centralizes the existing
   hand-rolled pattern behind the query-key convention; swapping its
   internals for React Query later touches only that file.
3. **No date-range picker / zone selector in TabShell yet.** No current tab
   consumes a date range (everything is "latest") and zone selection happens
   on the Overview map. They land with the first range-based tab (Prompt 1),
   reading from the shared store.
4. **Overview/Nodal components not relocated to `features/`.** Their data
   layers conform (adapters + shared hook + TabShell); moving the JSX is pure
   churn, deferred until they're next touched. `features/` is mandatory for
   new tabs.
5. **`GAForecast.probability` is null.** The pipeline emits categorical
   confidence, not calibrated probabilities. Prompt 3 needs numbers —
   pipeline work, flagged in `types/market.js`.
6. **`IntervalPrice.timestamp` from the series report is `HH:MM`, not ISO.**
   The `/api/ieso?report=series` payload carries no date. Fix in
   `api/ieso.js` before Prompt 1's cross-day spread math.
7. **`NodalPriceComponent` intentionally diverges from `IntervalPrice`** — it
   is a decomposition (energy/congestion/loss/basis) with the timestamp on
   the envelope. Reconciling is a Prompt 4 decision, not a silent migration.
8. **Tabs are `useState`-switched, not routes.** No router in the app;
   "route/component" in the contract maps to a `TABS` entry in `App.jsx`.
