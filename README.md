# IESO LMP Dashboard

A public-facing **Ontario electricity market dashboard** — a portfolio project
visualizing the IESO's zonal energy prices, provincial demand, and system
status.

> 🔌 The dashboard reads **live data from the IESO public reports** via a Vercel
> serverless proxy, and falls back to realistic mock data if the feed is
> unavailable (see [Live data](#live-data-from-the-ieso-public-reports)).

## Features

- **Dark-themed single-page app** (near-black canvas, slate/zinc palette).
- **Ontario map** (React-Leaflet, left 60%) with markers for the 7 IESO pricing
  zones — Northwest, Northeast, Ottawa, East, West, Southwest, Toronto — each
  colour-coded by its **Ontario Zonal Price** on a **blue → amber → red**
  gradient. Click a zone to load its price series.
- **24h price chart** (Recharts, right 40%) with **Real-Time** and **Day-Ahead**
  series for the selected zone.
- **GA Peak Risk** indicator (Green / Yellow / Red).
- **Bottom stat bar**: Ontario Demand (MW), Ontario Zonal Price ($/MWh), and
  System Condition (Normal / Tight / Emergency).
- **Live/Mock status badge** in the header so it's always clear which data the
  page is showing.

> ℹ️ **Note on the renewed market:** Ontario's Market Renewal Program (May 2025)
> retired the single **HOEP** and introduced **nodal LMP** plus per-zone
> **Ontario Zonal Prices (OZP)**. This dashboard uses the public zonal-price
> reports; the headline price tile is the OZP / Ontario Electricity Market Price
> (OEMP), the successor to HOEP.

## Tech stack

| Concern   | Choice                              |
| --------- | ----------------------------------- |
| Framework | React 18 + Vite                     |
| Map       | react-leaflet + Leaflet (OSM tiles) |
| Charts    | Recharts                            |
| Styling   | Tailwind CSS (configured via PostCSS) |
| Deploy    | Vercel                              |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (http://localhost:5173)
npm run dev

# 3. Production build + local preview
npm run build
npm run preview
```

## Project structure

```
ieso-lmp-dashboard/
├── index.html               # App entry / dark theme + metadata
├── package.json
├── vite.config.js
├── tailwind.config.js        # darkMode: 'class', canvas/panel colours
├── postcss.config.js
├── vercel.json               # Vite framework preset for Vercel
├── api/
│   └── ieso.js              # Serverless proxy: fetches + parses IESO XML
└── src/
    ├── main.jsx              # React root
    ├── index.css             # Tailwind layers + Leaflet CSS + dark tweaks
    ├── App.jsx               # Layout: header, map | chart/risk, bottom bar
    ├── data/
    │   ├── zones.js          # Canonical zone geography (shared)
    │   ├── iesoClient.js     # Fetches /api/ieso, falls back to mock
    │   ├── useIesoData.js    # React hooks (snapshot + per-zone series)
    │   └── mockData.js       # Fallback data + GA-risk / condition logic
    ├── utils/
    │   └── colorScale.js     # blue → amber → red price colour mapping
    └── components/
        ├── MapPanel.jsx      # Leaflet map + zone markers
        ├── ColorLegend.jsx   # Price gradient legend
        ├── PriceChart.jsx    # Recharts RT vs DA line chart
        ├── GAPeakRisk.jsx    # Green/Yellow/Red indicator
        ├── StatusBadge.jsx   # Live / Mock header pill
        ├── StatTile.jsx      # Single bottom-bar tile
        └── BottomBar.jsx     # Demand / Price / System Condition
```

## Deploying to Vercel

This repo is preconfigured for Vercel via `vercel.json` (framework preset
`vite`, build command `npm run build`, output `dist`).

1. Push the branch to GitHub.
2. Import the repo in Vercel — it auto-detects the Vite settings and the
   `api/` serverless function.
3. Deploy. No environment variables are required.

> **Local dev caveat:** `npm run dev` runs only the Vite frontend, so `/api/ieso`
> isn't served locally — the app will show **Mock data**. The live feed works on
> Vercel (and `vercel dev`), where the serverless function runs. See
> `docs/LOCAL_DEV.md`.

## Live data from the IESO public reports

The IESO publishes free, public market data (no API key) as XML on
`reports-public.ieso.ca`. Because those files are served without CORS headers
(and the legacy host is `http`), the browser can't fetch them directly — so a
**Vercel serverless function** (`api/ieso.js`) fetches and parses them
server-side and returns clean JSON.

### Data flow

```
browser  →  /api/ieso?report=…  →  reports-public.ieso.ca/*.xml
                 (parse XML → JSON, normalize, cache)
```

Reports used (field mappings confirmed against `docs/Sample-Reports/`):

| Purpose | Report |
| --- | --- |
| Per-zone 5-min price (map colour + chart "This zone" line) | `RealtimeZonalEnergyPrices/PUB_RealtimeZonalEnergyPrices.xml` |
| Province-wide real-time price (headline price tile) | `RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml` |
| Day-ahead hourly price (chart "Day-Ahead" line) | `DAHourlyOntarioZonalPrice/PUB_DAHourlyOntarioZonalPrice.xml` |
| Ontario demand (demand tile + GA risk) | `Demand/PUB_Demand.csv` |

Zone names in the price report are virtual-zone hubs (`TORONTO:HUB`,
`NORTHWEST:HUB`, …); we strip `:HUB` and match the 7 plotted zones. Each zone
lists 12 five-minute `IntervalPrice` rows for the current `DELIVERYHOUR`; the
"current price" is the latest interval that has a value. The demand report's
header is parsed (not assumed) to locate the `Ontario Demand` column.

### API endpoints (`/api/ieso`)

- `?report=snapshot` → `{ zones:[{id,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }`
- `?report=series&zone=<id>` → `{ series:[{label,zonePrice,dayAhead}], asOf }`
  — a rolling ~24h of 5-min `zonePrice` for the zone, stitched from the hourly
  archive files; `dayAhead` is the province day-ahead cleared price for each
  hour (a per-hour step across the window). `&debug=1` adds
  `{ usedArchive, hoursFetched, points }`.
- add `&debug=1` to either → also returns the **raw parsed report tree(s)**.

The frontend (`src/data/iesoClient.js` + `useIesoData.js`) calls these, merges
prices onto the zone geography, and **falls back to mock data** on any failure,
so the UI always renders. The header badge shows Live vs Mock.

### Refresh cadence

Real-time reports update every ~5 minutes. The function sets a 5-minute edge
cache (`s-maxage=300`, stale-while-revalidate), and the client re-fetches the
snapshot every 5 minutes.

### ⚠️ Verify once deployed (couldn't be tested without live network)

All four report mappings are validated against the committed sample files and
confirmed live (per-zone prices, province price, demand, and day-ahead). A few
behaviours still depend on the live server over time — open
`https://<your-app>.vercel.app/api/ieso?report=snapshot&debug=1` and confirm:

1. **Demand magnitude** — should read realistic provincial values
   (~12,000–22,000 MW). The `deriveSystemCondition` thresholds (19,000 / 22,000
   MW) assume those magnitudes. (The earlier `RealtimeDemandZonal` report
   carried scaled ~1,300 MW test values; we switched to `Demand/PUB_Demand.csv`,
   which reads ~15,000+.)
2. **Day-ahead day alignment** — `DAHourlyOntarioZonalPrice` is published per
   delivery day; we match the real-time `DELIVERYHOUR` to the same hour in the
   latest DA file. Around midnight / new DA publication the two can briefly
   reference different days.
3. **Actual 5-min refresh timing** — confirm new intervals appear roughly every
   5 minutes.

### Known limitations / next enhancements

- **Chart spans a rolling ~24h**, stitched from the hourly archive files in the
  `RealtimeZonalEnergyPrices/` directory (there is no single 24h report). This is
  **stateless** — no storage/cron. If the directory autoindex can't be read, the
  chart falls back to just the current hour. Verify on the deployed app:
  `…/api/ieso?report=series&zone=toronto&debug=1` should show
  `usedArchive: true`, `hoursFetched` near 24, and `points` in the low hundreds
  (≈288 when every hour is complete). If `usedArchive` is `false`, the autoindex
  format/retention differs — check the `fetchZonalArchive` regex against the
  live directory listing.
- **Day-ahead is province-wide**, while the real-time line is per-zone — the
  chart compares a zone's real-time price against the Ontario day-ahead price.
  Per-zone day-ahead would need a zonal day-ahead report.
- **Nodal LMP** (`PUB_RealtimeEnergyLMP.csv` / `PUB_DAHourlyEnergyLMP.csv`,
  900+ nodes) is available for a future node-level drill-down but needs a
  node→zone reference to aggregate.
