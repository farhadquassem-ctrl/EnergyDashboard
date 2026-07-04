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

## Deviations from the contract spec (deliberate)

1. **JSDoc, not TypeScript.** The repo is plain JS with no TS toolchain;
   converting was out of scope for a no-behavior-change pass. Typedefs in
   `types/market.js` convert 1:1 to `types/market.ts` if TS is adopted.
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
